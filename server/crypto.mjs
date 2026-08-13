import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function loadMasterKey(dataDir) {
  if (process.env.EVALHUB_MASTER_KEY) return createHash("sha256").update(process.env.EVALHUB_MASTER_KEY).digest();
  await mkdir(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, ".master-key");
  try {
    return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
    await chmod(keyPath, 0o600);
    return key;
  }
}

export function encryptSecret(value, key) {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptSecret(payload, key) {
  if (!payload) return "";
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
