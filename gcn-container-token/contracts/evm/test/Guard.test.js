const { expect } = require("chai");
const { assertTestnet } = require("../scripts/guard");

// The deploy guard checks the reported chainId, not just the network name.
const fakeHre = (name, chainId) => ({
  network: { name },
  ethers: { provider: { getNetwork: async () => ({ chainId }) } },
});

describe("deploy guard", () => {
  it("allows Hedera testnet (296), Sepolia and local hardhat", async () => {
    expect((await assertTestnet(fakeHre("hederaTestnet", 296))).label).to.match(/Hedera testnet/);
    expect((await assertTestnet(fakeHre("sepolia", 11155111))).chainId).to.equal(11155111);
    expect((await assertTestnet(fakeHre("localhost", 31337))).chainId).to.equal(31337);
  });

  it("refuses mainnet names, and a testnet name pointed at a mainnet chainId", async () => {
    for (const n of ["mainnet", "hederaMainnet", "polygonAmoy", "bscTestnet"]) {
      await expect(assertTestnet(fakeHre(n, 296))).to.be.rejectedWith(/testnet only/);
    }
    await expect(assertTestnet(fakeHre("hederaTestnet", 295))).to.be.rejectedWith(/chainId 295/);
    await expect(assertTestnet(fakeHre("sepolia", 1))).to.be.rejectedWith(/chainId 1 /);
  });
});
