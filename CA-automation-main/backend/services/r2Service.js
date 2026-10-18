// services/r2Service.js
// Cloudflare R2 Object Storage Service (AWS S3-compatible, Zero Egress Fees)
// CA Firm Automation Suite

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { keys } = require('../config/keys');

let s3Client = null;

function isR2Configured() {
  return Boolean(
    keys.R2_ACCESS_KEY_ID &&
    keys.R2_SECRET_ACCESS_KEY &&
    !keys.R2_ACCESS_KEY_ID.includes('your_') &&
    !keys.R2_SECRET_ACCESS_KEY.includes('your_')
  );
}

function getR2Client() {
  if (!s3Client && isR2Configured()) {
    const endpoint =
      keys.R2_ENDPOINT ||
      (keys.R2_ACCOUNT_ID ? `https://${keys.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

    if (endpoint) {
      s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: keys.R2_ACCESS_KEY_ID,
          secretAccessKey: keys.R2_SECRET_ACCESS_KEY,
        },
      });
    }
  }
  return s3Client;
}

/**
 * Upload a document to Cloudflare R2 Vault (with local fallback)
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} keyPath - e.g. "clients/CLIENT-001/bank_stmt_aug.pdf"
 * @returns {Promise<{ success: boolean, location: string, isCloud: boolean }>}
 */
async function uploadDocument(fileBuffer, fileName, mimeType, keyPath) {
  const client = getR2Client();
  const targetKey = keyPath || `vault/${Date.now()}_${fileName}`;

  if (client) {
    try {
      const command = new PutObjectCommand({
        Bucket: keys.R2_BUCKET_NAME,
        Key: targetKey,
        Body: fileBuffer,
        ContentType: mimeType || 'application/octet-stream',
      });

      await client.send(command);
      console.log(`[R2] ✅ Document uploaded to Cloudflare R2: ${targetKey}`);
      return {
        success: true,
        location: targetKey,
        isCloud: true,
      };
    } catch (err) {
      console.error(`[R2] ❌ Cloudflare R2 upload error:`, err.message);
    }
  }

  // Local fallback if R2 is unconfigured or fails
  try {
    const localDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

    const safeName = targetKey.replace(/[\/\\]/g, '_');
    const localPath = path.join(localDir, safeName);
    fs.writeFileSync(localPath, fileBuffer);

    console.log(`[R2-LOCAL] 📁 Saved document to local disk: ${localPath}`);
    return {
      success: true,
      location: localPath,
      isCloud: false,
    };
  } catch (err) {
    console.error(`[R2-LOCAL] ❌ Local storage fallback error:`, err.message);
    return { success: false, location: null, isCloud: false };
  }
}

/**
 * Generate pre-signed temporary download URL
 */
async function getSignedDownloadUrl(keyPath, expiresInSeconds = 3600) {
  const client = getR2Client();
  if (!client) return null;

  try {
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: keys.R2_BUCKET_NAME,
      Key: keyPath,
    });
    return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.error(`[R2] ❌ Error generating signed URL for ${keyPath}:`, err.message);
    return null;
  }
}

module.exports = {
  uploadDocument,
  getSignedDownloadUrl,
  isR2Configured,
};
