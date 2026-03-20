import { describe, expect, it } from "bun:test";
import { parseCorrection, parseCorrectionLoose } from "../src/parser/corrections.js";

describe("parseCorrection", () => {
  describe("Spanish prefixes", () => {
    it("parses 'no, 12k'", () => {
      const result = parseCorrection("no, 12k");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(12000);
    });

    it("parses 'era 10k'", () => {
      const result = parseCorrection("era 10k");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(10000);
    });

    it("parses 'eran 8k'", () => {
      const result = parseCorrection("eran 8k");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(8000);
    });

    it("parses 'en realidad 15k'", () => {
      const result = parseCorrection("en realidad 15k");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(15000);
    });

    it("parses 'mal, visa'", () => {
      const result = parseCorrection("mal, visa");
      expect(result).not.toBeNull();
      expect(result!.categoryHint).toBe("visa");
    });
  });

  describe("English prefixes", () => {
    it("parses 'actually 5k'", () => {
      const result = parseCorrection("actually 5k");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(5000);
    });

    it("parses 'no, restaurants'", () => {
      const result = parseCorrection("no, restaurants");
      expect(result).not.toBeNull();
      expect(result!.categoryHint).toBe("restaurants");
    });

    it("parses 'should be 20 usd'", () => {
      const result = parseCorrection("should be 20 usd");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(20);
      expect(result!.currency).toBe("USD");
    });
  });

  describe("multiple corrections", () => {
    it("parses amount + category", () => {
      const result = parseCorrection("no, 12k restaurants");
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(12000);
      expect(result!.categoryHint).toBe("restaurants");
    });

    it("parses category + account", () => {
      const result = parseCorrection("no, coffee visa");
      expect(result).not.toBeNull();
      expect(result!.categoryHint).toBe("coffee");
      expect(result!.assetHint).toBe("visa");
    });
  });

  describe("non-corrections", () => {
    it("returns null for normal text", () => {
      expect(parseCorrection("pizza 1500")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseCorrection("")).toBeNull();
    });

    it("returns null for prefix only", () => {
      expect(parseCorrection("no,")).toBeNull();
    });
  });
});

describe("parseCorrectionLoose", () => {
  it("parses bare amount", () => {
    const result = parseCorrectionLoose("12k");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(12000);
  });

  it("parses bare category", () => {
    const result = parseCorrectionLoose("restaurants");
    expect(result).not.toBeNull();
    expect(result!.categoryHint).toBe("restaurants");
  });

  it("parses bare amount + currency", () => {
    const result = parseCorrectionLoose("20 usd");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(20);
    expect(result!.currency).toBe("USD");
  });

  it("parses category + account", () => {
    const result = parseCorrectionLoose("coffee visa");
    expect(result).not.toBeNull();
    expect(result!.categoryHint).toBe("coffee");
    expect(result!.assetHint).toBe("visa");
  });

  it("returns null for empty string", () => {
    expect(parseCorrectionLoose("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseCorrectionLoose("   ")).toBeNull();
  });
});
