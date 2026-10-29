// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {RentalPlatform} from "./RentalPlatform.sol";

contract RentalPlatformAssetsTest is Test {
    RentalPlatform private platform;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);
    event AssetRemoved(uint256 indexed assetId, address indexed owner);

    function setUp() public {
        platform = new RentalPlatform();
        vm.prank(alice);
        platform.registerAsset(1 ether);
        vm.deal(bob, 10 ether);
    }

    function test_RegistrationCommitsDetailsAndEnumeratesAssets() public {
        bytes32 commitment = keccak256("Camping tent details");
        vm.prank(bob);
        uint256 id = platform.registerAssetWithMetadata(0.01 ether, commitment);
        assertEq(id, 2);
        assertEq(platform.metadataHashes(id), commitment);
        assertTrue(platform.usedAssetIds(id));
        (address owner,,,) = platform.assets(id);
        assertEq(owner, bob);
        uint256[] memory ids = platform.getAssetIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
    }

    function test_EmptyMetadataCommitmentDoesNotRegisterAnAsset() public {
        vm.expectRevert(bytes("Metadata hash required"));
        platform.registerAssetWithMetadata(1 ether, bytes32(0));
        assertFalse(platform.usedAssetIds(2));
        assertEq(platform.nextAssetId(), 2);
        assertEq(platform.getAssetIds().length, 1);
    }

    function test_OnlyOwnerCanRemoveAnExistingAsset() public {
        vm.expectRevert(bytes("Only owner can remove asset"));
        vm.prank(bob);
        platform.removeAsset(1);
        vm.expectRevert(bytes("Asset does not exist"));
        vm.prank(alice);
        platform.removeAsset(99);
        assertEq(platform.getAssetIds().length, 1);
    }

    function test_RemovalAtExactExpiryPreservesEarnings() public {
        vm.prank(bob);
        platform.rentAsset{value: 1 ether}(1, 1);
        (,,uint256 expiry,) = platform.assets(1);
        vm.warp(expiry - 1);
        vm.expectRevert(bytes("Cannot remove rented asset"));
        vm.prank(alice);
        platform.removeAsset(1);

        vm.warp(expiry);
        vm.expectEmit(true, true, false, true);
        emit AssetRemoved(1, alice);
        vm.prank(alice);
        platform.removeAsset(1);
        assertEq(platform.getAssetIds().length, 0);
        assertEq(platform.balances(alice), 1 ether);
        vm.prank(alice);
        platform.withdraw();
        assertEq(alice.balance, 1 ether);
    }

    function test_RemovedAssetCannotBeRentedUnlockedOrRemovedAgain() public {
        vm.prank(alice);
        platform.removeAsset(1);
        vm.expectRevert(bytes("Asset does not exist"));
        vm.prank(bob);
        platform.rentAsset{value: 1 ether}(1, 1);
        vm.expectRevert(bytes("Asset does not exist"));
        platform.canUnlock(1, alice);
        vm.expectRevert(bytes("Asset does not exist"));
        vm.prank(alice);
        platform.removeAsset(1);
    }

    function test_EnumerationSurvivesFirstMiddleAndLastRemoval() public {
        vm.startPrank(alice);
        platform.registerAsset(0);
        platform.registerAsset(0);
        platform.registerAsset(0);
        platform.removeAsset(2);
        assertEq(platform.getAssetIds().length, 3);
        platform.removeAsset(4);
        platform.removeAsset(1);
        assertEq(platform.getAssetIds()[0], 3);
        platform.removeAsset(3);
        assertEq(platform.getAssetIds().length, 0);
        vm.stopPrank();
    }

    function testFuzz_RemovedIdsAreNeverReassigned(uint8 count) public {
        bytes32 commitment = keccak256("details");
        uint256 iterations = uint256(count) % 32 + 1;
        vm.startPrank(bob);
        for (uint256 i = 0; i < iterations; i++) {
            uint256 id = platform.registerAssetWithMetadata(0, commitment);
            assertEq(id, i + 2);
            platform.removeAsset(id);
            assertTrue(platform.usedAssetIds(id));
            assertEq(platform.metadataHashes(id), bytes32(0));
            (address owner,,,) = platform.assets(id);
            assertEq(owner, address(0));
        }
        assertEq(platform.registerAsset(0), iterations + 2);
        vm.stopPrank();
    }
}
