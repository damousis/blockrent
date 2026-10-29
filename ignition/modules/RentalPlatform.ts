import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("RentalPlatformModule", (m) => {
  const rentalPlatform = m.contract("RentalPlatform");
  return { rentalPlatform };
});
