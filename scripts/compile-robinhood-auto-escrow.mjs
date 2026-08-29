import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import solc from "solc";

const sourcePath = resolve("contracts/RobinhoodChessEscrowV2.sol");
const artifactPath = resolve("artifacts/RobinhoodChessEscrowV2.json");
const source = await readFile(sourcePath, "utf8");
const input = {
  language: "Solidity",
  sources: { "RobinhoodChessEscrowV2.sol": { content: source } },
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 500 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length) {
  throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
}
for (const warning of (output.errors ?? []).filter((entry) => entry.severity === "warning")) {
  console.warn(warning.formattedMessage);
}
const contract = output.contracts?.["RobinhoodChessEscrowV2.sol"]?.RobinhoodChessEscrowV2;
if (!contract?.evm?.bytecode?.object) throw new Error("RobinhoodChessEscrowV2 compiler output is missing");
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify({
  contractName: "RobinhoodChessEscrowV2",
  sourceName: "RobinhoodChessEscrowV2.sol",
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
}, null, 2)}\n`);
console.log(`Wrote ${artifactPath}`);
