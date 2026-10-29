// Demo metadata, not a shared database. IDs join these descriptions to Solidity.
// dailyPriceEth is used only to seed NEW assets, never to charge for a rental.
export const assets = [
  {
    id: 1, name: "City Bicycle", category: "Bike",
    description: "Take the scenic route. A comfortable city bike for everyday exploring.",
    image: "/images/bicycle.svg", dailyPriceEth: "0.01",
    attributes: { Gears: "7 speed", Size: "Medium" },
  },
  {
    id: 2, name: "Toyota Corolla", category: "Car",
    description: "A practical set of wheels for errands, day trips, and getting out of town.",
    image: "/images/car.svg", dailyPriceEth: "0.05",
    attributes: { Year: "2008", Fuel: "Diesel" },
  },
  {
    id: 3, name: "Cordless Drill", category: "Tool",
    description: "Make a little progress on that big idea. Ready for your next home project.",
    image: "/images/drill.svg", dailyPriceEth: "0.005",
    attributes: { Power: "18 V", Includes: "Battery & bits" },
  },
];
