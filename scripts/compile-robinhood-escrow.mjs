import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import solc from "solc";

const sourcePath = resolve("contracts/RobinhoodChessEscrow.sol");
const artifactPath = resolve("artifacts/RobinhoodChessEscrow.json");
const source = await readFile(sourcePath, "utf8");
const input = {
  language: "Solidity",
  sources: { "RobinhoodChessEscrow.sol": { content: source } },
  settings: {
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
const contract = output.contracts?.["RobinhoodChessEscrow.sol"]?.RobinhoodChessEscrow;
if (!contract?.evm?.bytecode?.object) throw new Error("RobinhoodChessEscrow compiler output is missing");
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify({
  contractName: "RobinhoodChessEscrow",
  sourceName: "RobinhoodChessEscrow.sol",
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
}, null, 2)}\n`);
console.log(`Wrote ${artifactPath}`);
