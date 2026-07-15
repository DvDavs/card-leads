import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ingest } from "../../src/stages/ingest.js";

/**
 * Tests de que `ingest` estampa el tracking inicial (created_by + folder) que le
 * pasa el panel. No usa LLM: ingest solo copia imágenes y escribe data.json.
 */

const FRONT = fileURLToPath(new URL("../fixtures/card-front.png", import.meta.url));

describe("ingest — tracking inicial", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "card-leads-ingest-track-"));
    process.env.LEADS_DIR = tmpRoot;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.LEADS_DIR;
  });

  it("estampa created_by y folder cuando se pasan", async () => {
    const lead = await ingest({ front: FRONT, slug: "dr-a", createdBy: "David", folder: "David" });
    expect(lead.tracking?.created_by).toBe("David");
    expect(lead.tracking?.folder).toBe("David");
    expect(lead.tracking?.send_state).toBe("draft");
  });

  it("sin createdBy/folder deja el tracking en 'draft' sin carpeta ni autor", async () => {
    const lead = await ingest({ front: FRONT, slug: "dr-b" });
    expect(lead.tracking?.send_state).toBe("draft");
    expect(lead.tracking?.created_by).toBeUndefined();
    expect(lead.tracking?.folder).toBeUndefined();
  });
});
