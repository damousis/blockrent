// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @notice Registry of assets, paid rentals, and temporary access rights.
contract RentalPlatform {
    struct Asset {
        address owner;
        address renter;
        uint256 rentedUntil;
        uint256 pricePerDay;
    }

    uint256 public constant MAX_RENTAL_DAYS = 30;
    uint256 public constant MAX_PRICE_PER_DAY = type(uint256).max / MAX_RENTAL_DAYS;
    uint256 public constant MAX_PAGE_SIZE = 50;
    uint256 public nextAssetId = 1;

    mapping(uint256 => Asset) public assets;
    // IDs stay reserved after removal so an old ID cannot identify a different asset.
    mapping(uint256 => bool) public usedAssetIds;
    mapping(uint256 => bytes32) public metadataHashes;
    uint256[] private assetIds;
    mapping(uint256 => uint256) private assetIndexes;
    // ETH earned by each owner, held here until they withdraw it.
    mapping(address => uint256) public balances;

    event AssetRegistered(uint256 indexed assetId, address indexed owner, uint256 pricePerDay);
    event AssetRemoved(uint256 indexed assetId, address indexed owner);
    event AssetRented(uint256 indexed assetId, address indexed renter, uint256 rentedUntil);
    event Withdrawal(address indexed owner, uint256 amount);

    function registerAsset(uint256 pricePerDay) public returns (uint256 assetId) {
        require(pricePerDay <= MAX_PRICE_PER_DAY, "Daily price too large");
        assetId = nextAssetId++;
        usedAssetIds[assetId] = true;
        assetIndexes[assetId] = assetIds.length;
        assetIds.push(assetId);

        assets[assetId] = Asset({
            owner: msg.sender,
            renter: address(0),
            rentedUntil: 0,
            pricePerDay: pricePerDay
        });

        emit AssetRegistered(assetId, msg.sender, pricePerDay);
    }

    /// @notice Commit to off-chain details in the same transaction as registration.
    function registerAssetWithMetadata(uint256 pricePerDay, bytes32 metadataHash) external returns (uint256 assetId) {
        require(metadataHash != bytes32(0), "Metadata hash required");
        assetId = registerAsset(pricePerDay);
        metadataHashes[assetId] = metadataHash;
    }

    function getAssetIds() external view returns (uint256[] memory) {
        // Compatibility helper: never return more than one bounded page.
        return getAssetIdsPage(0, MAX_PAGE_SIZE);
    }

    function getAssetCount() external view returns (uint256) {
        return assetIds.length;
    }

    /// @notice Bounded reads for clients. Enumeration order may change on removal.
    function getAssetIdsPage(uint256 offset, uint256 limit) public view returns (uint256[] memory ids) {
        require(limit > 0 && limit <= MAX_PAGE_SIZE, "Page size must be 1-50");
        if (offset >= assetIds.length) return new uint256[](0);
        uint256 count = assetIds.length - offset;
        if (count > limit) count = limit;
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) ids[i] = assetIds[offset + i];
    }

    function removeAsset(uint256 assetId) external {
        Asset storage asset = assets[assetId];
        require(asset.owner != address(0), "Asset does not exist");
        require(msg.sender == asset.owner, "Only owner can remove asset");
        require(block.timestamp >= asset.rentedUntil, "Cannot remove rented asset");

        uint256 index = assetIndexes[assetId];
        uint256 lastId = assetIds[assetIds.length - 1];
        assetIds[index] = lastId;
        assetIndexes[lastId] = index;
        assetIds.pop();
        delete assetIndexes[assetId];
        delete assets[assetId];
        delete metadataHashes[assetId];

        emit AssetRemoved(assetId, msg.sender);
    }

    function rentAsset(uint256 assetId, uint256 durationDays) external payable {
        Asset storage asset = assets[assetId];
        require(asset.owner != address(0), "Asset does not exist");
        require(msg.sender != asset.owner, "Owner cannot rent own asset");
        require(block.timestamp >= asset.rentedUntil, "Asset already rented");
        require(durationDays >= 1 && durationDays <= MAX_RENTAL_DAYS, "Duration must be 1-30 days");

        uint256 totalPrice = asset.pricePerDay * durationDays;
        require(msg.value == totalPrice, "Incorrect payment");

        asset.renter = msg.sender;
        asset.rentedUntil = block.timestamp + durationDays * 1 days;
        balances[asset.owner] += msg.value;

        emit AssetRented(assetId, msg.sender, asset.rentedUntil);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");

        // Clear the credit before calling the recipient so it cannot be spent twice.
        balances[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit Withdrawal(msg.sender, amount);
    }

    function currentPossessor(uint256 assetId) public view returns (address) {
        Asset storage asset = assets[assetId];
        require(asset.owner != address(0), "Asset does not exist");

        return block.timestamp < asset.rentedUntil ? asset.renter : asset.owner;
    }

    /// @dev This checks permission only; callers must separately prove wallet control.
    function canUnlock(uint256 assetId, address wallet) external view returns (bool) {
        return currentPossessor(assetId) == wallet;
    }
}
