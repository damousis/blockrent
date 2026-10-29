// Setup writes deployment.json locally. A fresh checkout can still show the
// website and a useful setup message before that generated file exists.
const saved = import.meta.glob("./deployment.json", { eager: true, import: "default" });
export const config = saved["./deployment.json"] ?? {
  address: null,
  chainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  runtimeCodeHash: null,
};
