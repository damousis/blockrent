// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {RentalPlatform} from "./RentalPlatform.sol";

// Test-only owner contract that can reject ETH or attempt a second withdrawal.
contract TestRentalOwner {
    RentalPlatform private immutable platform;
    bool public rejectPayment;
    bool public attemptReentry;
    bool public reentrySucceeded;

    constructor(RentalPlatform platform_) {
        platform = platform_;
    }

    function registerAsset(uint256 price) external {
        platform.registerAsset(price);
    }

    function configure(bool reject, bool reenter) external {
        rejectPayment = reject;
        attemptReentry = reenter;
    }

    function withdraw() external {
        platform.withdraw();
    }

    receive() external payable {
        require(!rejectPayment, "Recipient rejected ETH");
        if (attemptReentry) {
            attemptReentry = false;
            (reentrySucceeded, ) = address(platform).call(abi.encodeCall(platform.withdraw, ()));
        }
    }
}

contract RentalPlatformWithdrawalTest is Test {
    RentalPlatform private platform;
    TestRentalOwner private owner;
    address private bob = address(0xB0B);
    address private alice = address(0xA11CE);

    function setUp() public {
        platform = new RentalPlatform();
        owner = new TestRentalOwner(platform);
        owner.registerAsset(1 ether);
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        platform.rentAsset{value: 1 ether}(1, 1);
    }

    function test_FailedTransferRestoresCreditAndAllowsRetry() public {
        owner.configure(true, false);
        vm.expectRevert(bytes("Withdrawal failed"));
        owner.withdraw();
        assertEq(platform.balances(address(owner)), 1 ether);
        assertEq(address(platform).balance, 1 ether);
        assertEq(address(owner).balance, 0);

        owner.configure(false, false);
        owner.withdraw();
        assertEq(platform.balances(address(owner)), 0);
        assertEq(address(platform).balance, 0);
        assertEq(address(owner).balance, 1 ether);
    }

    function test_ReentryCannotWithdrawTwiceOrTakeAnotherOwnersFunds() public {
        vm.prank(alice);
        platform.registerAsset(2 ether);
        vm.prank(bob);
        platform.rentAsset{value: 2 ether}(2, 1);

        owner.configure(false, true);
        owner.withdraw();
        assertFalse(owner.reentrySucceeded());
        assertEq(address(owner).balance, 1 ether);
        assertEq(platform.balances(address(owner)), 0);
        assertEq(platform.balances(alice), 2 ether);
        assertEq(address(platform).balance, 2 ether);
    }
}
