const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ContainerToken (pre-audit)", () => {
  let token, admin, alice, bob;
  const docs = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("bundle"));
  const ev = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("evidence"));

  beforeEach(async () => {
    [admin, alice, bob] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("ContainerToken")).deploy(admin.address);
    await token.deployed();
  });

  it("registers one token per ISO id and rejects duplicates", async () => {
    await token.register(alice.address, "CSQU3054383", "45G1", docs);
    await expect(token.register(alice.address, "CSQU3054383", "45G1", docs)).to.be.revertedWith("container already tokenised");
  });

  it("rejects malformed ids and empty docs hash", async () => {
    await expect(token.register(alice.address, "SHORT", "45G1", docs)).to.be.revertedWith("ISO 6346 id must be 11 chars");
    await expect(token.register(alice.address, "CSQU3054383", "45G1", ethers.constants.HashZero)).to.be.revertedWith("docs hash required");
  });

  it("requires an ISO 6346 size/type code, not yard shorthand", async () => {
    await expect(token.register(alice.address, "CSQU3054383", "40HC", docs))
      .to.be.revertedWith("size/type char 4 must be a digit - yard shorthand is not an ISO 6346 code");
    await token.register(alice.address, "CSQU3054383", "45G1", docs); // the carrier-facing code
  });

  it("allows transfer when registered", async () => {
    await token.register(alice.address, "CSQU3054383", "45G1", docs);
    await token.connect(alice).transferFrom(alice.address, bob.address, 1);
    expect(await token.ownerOf(1)).to.equal(bob.address);
  });

  it("blocks transfer while Held", async () => {
    await token.register(alice.address, "CSQU3054383", "45G1", docs);
    await token.setStatus(1, 3); // Held
    await expect(token.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWith("container held");
  });

  it("blocks in-transit transfer without vessel attestation, or with low MTI", async () => {
    await token.register(alice.address, "CSQU3054383", "45G1", docs);
    await token.setStatus(1, 1); // InTransit
    await expect(token.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWith("in transit without vessel attestation");
    await token.attestVessel(1, 9321483, 1, ev);
    await expect(token.connect(alice).transferFrom(alice.address, bob.address, 1)).to.be.revertedWith("vessel MTI below policy");
    await token.attestVessel(1, 9321483, 4, ev);
    await token.connect(alice).transferFrom(alice.address, bob.address, 1);
    expect(await token.ownerOf(1)).to.equal(bob.address);
  });

  it("restricts roles and MTI range", async () => {
    await expect(token.connect(alice).register(alice.address, "CSQU3054383", "45G1", docs)).to.be.reverted;
    await token.register(alice.address, "CSQU3054383", "45G1", docs);
    await expect(token.attestVessel(1, 1, 6, ev)).to.be.revertedWith("MTI score is 0-5");
  });
});
