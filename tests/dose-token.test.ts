import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface TokenMetadata {
  drugType: string;
  batchId: number;
  serialNumber: Uint8Array;
  expiration: number;
  status: string;
  manufacturer: string;
  metadataHash: Uint8Array;
}

interface ContractState {
  tokens: Map<number, string>;
  metadata: Map<number, TokenMetadata>;
  approvals: Map<number, string>;
  lastTokenId: number;
  name: string;
  symbol: string;
  admin: string;
}

// Mock contract implementation
class DoseTokenMock {
  private state: ContractState = {
    tokens: new Map(),
    metadata: new Map(),
    approvals: new Map(),
    lastTokenId: 0,
    name: "PillTrack Dose Token",
    symbol: "PDT",
    admin: "deployer",
  };

  private ERR_NOT_AUTHORIZED = 401;
  private ERR_INVALID_TOKEN_ID = 402;
  private ERR_INVALID_METADATA = 403;
  private ERR_TOKEN_ALREADY_MINTED = 404;
  private ERR_EXPIRED_TOKEN = 405;
  private ERR_INVALID_STATUS = 406;
  private ERR_NOT_OWNER = 407;
  private ERR_INVALID_EXPIRATION = 408;
  private ERR_METADATA_EXCEEDS_LIMIT = 409;

  getName(): ClarityResponse<string> {
    return { ok: true, value: this.state.name };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: this.state.symbol };
  }

  getLastTokenId(): ClarityResponse<number> {
    return { ok: true, value: this.state.lastTokenId };
  }

  getOwner(tokenId: number): ClarityResponse<string | null> {
    const owner = this.state.tokens.get(tokenId);
    return owner ? { ok: true, value: owner } : { ok: false, value: this.ERR_INVALID_TOKEN_ID };
  }

  getMetadata(tokenId: number): ClarityResponse<TokenMetadata | null> {
    return { ok: true, value: this.state.metadata.get(tokenId) ?? null };
  }

  getApproval(tokenId: number): ClarityResponse<string | null> {
    const approval = this.state.approvals.get(tokenId);
    return approval ? { ok: true, value: approval } : { ok: true, value: null };
  }

  isAdmin(caller: string): boolean {
    return caller === this.state.admin;
  }

  isOwner(tokenId: number, caller: string): boolean {
    const owner = this.state.tokens.get(tokenId);
    return owner !== undefined && owner === caller;
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (!this.isAdmin(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  mint(
    caller: string,
    tokenId: number,
    recipient: string,
    meta: TokenMetadata
  ): ClarityResponse<boolean> {
    if (!this.isAdmin(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (this.state.tokens.has(tokenId)) {
      return { ok: false, value: this.ERR_TOKEN_ALREADY_MINTED };
    }
    if (!this.validateMetadata(meta)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    if (meta.serialNumber.length > 16) {
      return { ok: false, value: this.ERR_METADATA_EXCEEDS_LIMIT };
    }
    if (meta.expiration <= 100) { // Mock block height
      return { ok: false, value: this.ERR_INVALID_EXPIRATION };
    }
    this.state.tokens.set(tokenId, recipient);
    this.state.metadata.set(tokenId, meta);
    if (tokenId > this.state.lastTokenId) {
      this.state.lastTokenId = tokenId;
    }
    return { ok: true, value: true };
  }

  private validateMetadata(meta: TokenMetadata): boolean {
    return (
      meta.drugType.length >= 1 &&
      meta.drugType.length <= 32 &&
      meta.expiration > 100 && // Mock current block
      (meta.status === "active" || meta.status === "dispensed") &&
      meta.status === "active" // Initial
    );
  }

  transfer(
    caller: string,
    tokenId: number,
    sender: string,
    recipient: string
  ): ClarityResponse<boolean> {
    if (!this.isOwner(tokenId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (caller === recipient) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    if (!this.state.tokens.has(tokenId)) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    if (sender !== this.state.tokens.get(tokenId)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    this.state.tokens.set(tokenId, recipient);
    this.state.approvals.delete(tokenId);
    return { ok: true, value: true };
  }

  setApproval(caller: string, tokenId: number, spender: string): ClarityResponse<boolean> {
    if (!this.isOwner(tokenId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    this.state.approvals.set(tokenId, spender);
    return { ok: true, value: true };
  }

  transferFrom(
    caller: string,
    tokenId: number,
    sender: string,
    recipient: string
  ): ClarityResponse<boolean> {
    const approval = this.state.approvals.get(tokenId);
    if (!approval && caller !== sender) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (!this.isOwner(tokenId, sender)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    this.state.tokens.set(tokenId, recipient);
    this.state.approvals.delete(tokenId);
    return { ok: true, value: true };
  }

  updateStatus(caller: string, tokenId: number, newStatus: string): ClarityResponse<boolean> {
    if (!this.isOwner(tokenId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const meta = this.state.metadata.get(tokenId);
    if (!meta) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    if (!["dispensed", "redeemed", "recalled"].includes(newStatus)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.metadata.set(tokenId, { ...meta, status: newStatus });
    return { ok: true, value: true };
  }

  burn(caller: string, tokenId: number): ClarityResponse<boolean> {
    if (!this.isOwner(tokenId, caller)) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const meta = this.state.metadata.get(tokenId);
    if (!meta) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    if (meta.status === "active") {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    this.state.tokens.delete(tokenId);
    this.state.metadata.delete(tokenId);
    this.state.approvals.delete(tokenId);
    return { ok: true, value: true };
  }

  isExpired(tokenId: number): ClarityResponse<boolean> {
    const meta = this.state.metadata.get(tokenId);
    if (!meta) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    return { ok: true, value: meta.expiration <= 100 }; // Mock block height 100
  }

  batchMint(
    caller: string,
    startId: number,
    count: number,
    recipient: string,
    baseMeta: Omit<TokenMetadata, "serialNumber" | "metadataHash">,
    serialBase: Uint8Array
  ): ClarityResponse<{ startId: number; endId: number }> {
    if (!this.isAdmin(caller)) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    if (count <= 0) {
      return { ok: false, value: this.ERR_INVALID_TOKEN_ID };
    }
    if (!this.validateBaseMetadata(baseMeta)) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const endId = startId + count - 1;
    // Simulate batch: In real, loop or recurse
    for (let i = startId; i <= endId; i++) {
      const serial = new Uint8Array([...serialBase, i]);
      const meta: TokenMetadata = {
        ...baseMeta,
        serialNumber: serial,
        metadataHash: new Uint8Array(32).fill(0), // Mock hash
      };
      this.mint(caller, i, recipient, meta as TokenMetadata);
    }
    return { ok: true, value: { startId, endId } };
  }

  private validateBaseMetadata(base: Omit<TokenMetadata, "serialNumber" | "metadataHash">): boolean {
    return (
      base.drugType.length >= 1 &&
      base.status === "active" &&
      base.expiration > 100
    );
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  manufacturer: "wallet_1",
  distributor: "wallet_2",
  patient: "wallet_3",
};

describe("DoseToken Contract", () => {
  let contract: DoseTokenMock;

  beforeEach(() => {
    contract = new DoseTokenMock();
    vi.resetAllMocks();
  });

  it("should initialize with correct token metadata", () => {
    expect(contract.getName()).toEqual({ ok: true, value: "PillTrack Dose Token" });
    expect(contract.getSymbol()).toEqual({ ok: true, value: "PDT" });
    expect(contract.getLastTokenId()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to mint a new token with valid metadata", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    const mintResult = contract.mint(accounts.deployer, 1, accounts.distributor, meta);
    expect(mintResult).toEqual({ ok: true, value: true });

    expect(contract.getOwner(1)).toEqual({ ok: true, value: accounts.distributor });
    expect(contract.getLastTokenId()).toEqual({ ok: true, value: 1 });

    const mintedMeta = contract.getMetadata(1);
    expect(mintedMeta).toEqual({ ok: true, value: expect.objectContaining({ drugType: "Aspirin", status: "active" }) });
  });

  it("should prevent non-admin from minting", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    const mintResult = contract.mint(accounts.distributor, 1, accounts.patient, meta);
    expect(mintResult).toEqual({ ok: false, value: 401 });
  });

  it("should prevent minting already existing token", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);
    const secondMint = contract.mint(accounts.deployer, 1, accounts.patient, meta);
    expect(secondMint).toEqual({ ok: false, value: 404 });
  });

  it("should allow token transfer by owner", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);

    const transferResult = contract.transfer(accounts.distributor, 1, accounts.distributor, accounts.patient);
    expect(transferResult).toEqual({ ok: true, value: true });

    expect(contract.getOwner(1)).toEqual({ ok: true, value: accounts.patient });
  });

  it("should prevent transfer by non-owner", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);

    const transferResult = contract.transfer(accounts.patient, 1, accounts.distributor, accounts.patient);
    expect(transferResult).toEqual({ ok: false, value: 407 });
  });

  it("should allow setting and using approval for transfer-from", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);
    contract.setApproval(accounts.distributor, 1, accounts.patient);

    const approval = contract.getApproval(1);
    expect(approval).toEqual({ ok: true, value: accounts.patient });

    const transferFromResult = contract.transferFrom(accounts.patient, 1, accounts.distributor, "new-owner");
    expect(transferFromResult).toEqual({ ok: true, value: true });

    expect(contract.getApproval(1)).toEqual({ ok: true, value: null });
  });

  it("should allow owner to update status to valid values", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);

    const updateResult = contract.updateStatus(accounts.distributor, 1, "redeemed");
    expect(updateResult).toEqual({ ok: true, value: true });

    const updatedMeta = contract.getMetadata(1);
    expect(updatedMeta).toEqual({ ok: true, value: expect.objectContaining({ status: "redeemed" }) });
  });

  it("should prevent invalid status update", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);

    const updateResult = contract.updateStatus(accounts.distributor, 1, "invalid");
    expect(updateResult).toEqual({ ok: false, value: 406 });
  });

  it("should allow owner to burn non-active token", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active", // Initially active
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);
    contract.updateStatus(accounts.distributor, 1, "redeemed"); // Change to non-active

    const burnResult = contract.burn(accounts.distributor, 1);
    expect(burnResult).toEqual({ ok: true, value: true });

    expect(contract.getOwner(1)).toEqual({ ok: false, value: 402 });
  });

  it("should prevent burning active token", () => {
    const meta: TokenMetadata = {
      drugType: "Aspirin",
      batchId: 1,
      serialNumber: new Uint8Array([1, 2, 3]),
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
      metadataHash: new Uint8Array(32).fill(0),
    };

    contract.mint(accounts.deployer, 1, accounts.distributor, meta);

    const burnResult = contract.burn(accounts.distributor, 1);
    expect(burnResult).toEqual({ ok: false, value: 406 });
  });

  it("should allow admin batch mint", () => {
    const baseMeta = {
      drugType: "Aspirin",
      batchId: 1,
      expiration: 200,
      status: "active",
      manufacturer: accounts.manufacturer,
    };
    const serialBase = new Uint8Array([1, 2, 3]);

    const batchResult = contract.batchMint(accounts.deployer, 1, 3, accounts.distributor, baseMeta, serialBase);
    expect(batchResult).toEqual({ ok: true, value: { startId: 1, endId: 3 } });

    expect(contract.getOwner(1)).toEqual({ ok: true, value: accounts.distributor });
    expect(contract.getOwner(2)).toEqual({ ok: true, value: accounts.distributor });
    expect(contract.getOwner(3)).toEqual({ ok: true, value: accounts.distributor });
  });

  it("should allow admin to set new admin", () => {
    const setAdminResult = contract.setAdmin(accounts.deployer, accounts.manufacturer);
    expect(setAdminResult).toEqual({ ok: true, value: true });

    expect(contract.isAdmin(accounts.manufacturer)).toBe(true);
  });

  it("should prevent non-admin from setting admin", () => {
    const setAdminResult = contract.setAdmin(accounts.distributor, accounts.manufacturer);
    expect(setAdminResult).toEqual({ ok: false, value: 401 });
  });
});