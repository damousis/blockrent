// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {RentalPlatform} from "./RentalPlatform.sol";

contract RentalPlatformSecurityTest is Test {
    RentalPlatform private platform;

    function setUp() public { platform = new RentalPlatform(); }

    function test_OversizedPricesRevertBeforeConsumingAnId() public {
        uint256 maximum = platform.MAX_PRICE_PER_DAY();
        vm.expectRevert(bytes("Daily price too large"));
        platform.registerAsset(maximum + 1);
        assertEq(platform.nextAssetId(), 1);
        vm.expectRevert(bytes("Daily price too large"));
        platform.registerAssetWithMetadata(maximum + 1, keccak256("details"));
        assertEq(platform.getAssetCount(), 0);
    }

    function test_MaximumDailyPriceCanBeMultipliedForAllAllowedDays() public {
        uint256 maximum = platform.MAX_PRICE_PER_DAY();
        platform.registerAsset(maximum);
        address renter = address(0xB0B);
        vm.deal(renter, maximum * 30);
        vm.prank(renter);
        platform.rentAsset{value: maximum * 30}(1, 30);
        assertEq(platform.balances(address(this)), maximum * 30);
    }

    function test_PagesAreBoundedAndOffsetsCannotOverflow() public {
        for (uint256 i = 0; i < 53; i++) platform.registerAsset(0);
        assertEq(platform.getAssetCount(), 53);
        assertEq(platform.getAssetIds().length, 50);
        uint256[] memory first = platform.getAssetIdsPage(0, 50);
        uint256[] memory second = platform.getAssetIdsPage(50, 50);
        assertEq(first.length, 50);
        assertEq(first[49], 50);
        assertEq(second.length, 3);
        assertEq(second[0], 51);
        assertEq(platform.getAssetIdsPage(type(uint256).max, 50).length, 0);
        vm.expectRevert(bytes("Page size must be 1-50"));
        platform.getAssetIdsPage(0, 51);
        vm.expectRevert(bytes("Page size must be 1-50"));
        platform.getAssetIdsPage(0, 0);
    }

    function testFuzz_PagedIdsMatchCurrentEnumeration(uint8 removed) public {
        for (uint256 i = 0; i < 10; i++) platform.registerAsset(0);
        platform.removeAsset(uint256(removed) % 10 + 1);
        uint256[] memory all = platform.getAssetIds();
        uint256[] memory page = platform.getAssetIdsPage(0, 50);
        assertEq(page, all);
        assertEq(page.length, platform.getAssetCount());
    }

    function testFuzz_RentAndWithdrawPreserveSolvency(uint96 price, uint8 daysInput) public {
        uint256 duration = uint256(daysInput) % 30 + 1;
        uint256 total = uint256(price) * duration;
        address owner = address(0xA11CE);
        address renter = address(0xB0B);
        vm.prank(owner);
        uint256 assetId = platform.registerAsset(price);
        vm.deal(address(this), total);
        vm.deal(renter, total);
        vm.prank(renter);
        platform.rentAsset{value: total}(assetId, duration);
        assertEq(address(platform).balance, total);
        assertEq(platform.balances(owner), total);
        if (total > 0) {
            vm.prank(owner);
            platform.withdraw();
            assertEq(owner.balance, total);
            assertEq(platform.balances(owner), 0);
            assertEq(address(platform).balance, 0);
        }
    }
}
