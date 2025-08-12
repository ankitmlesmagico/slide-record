const Minio = require('minio');

// MinIO configuration
const minioConfig = {
  endPoint: 'localhost',
  port: 9000,
  useSSL: false,
  accessKey: 'localminio', // Your MinIO credentials
  secretKey: 'localsecret'
};

// Create MinIO client
const minioClient = new Minio.Client(minioConfig);

// Bucket name for storing recordings
const BUCKET_NAME = 'slide-recordings';

/**
 * Initialize MinIO bucket
 */
async function initializeBucket() {
  try {
    const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
    
    if (!bucketExists) {
      console.log(`Creating bucket: ${BUCKET_NAME}`);
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      
      // Set bucket policy to allow public read access
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`]
          }
        ]
      };
      
      await minioClient.setBucketPolicy(BUCKET_NAME, JSON.stringify(policy));
      console.log(`✅ Bucket ${BUCKET_NAME} created and configured for public access`);
    } else {
      console.log(`✅ Bucket ${BUCKET_NAME} already exists`);
    }
  } catch (error) {
    console.error('❌ Error initializing MinIO bucket:', error);
    throw error;
  }
}

/**
 * Upload file to MinIO
 * @param {string} filePath - Local file path
 * @param {string} objectName - Object name in MinIO
 * @returns {Promise<string>} - Public URL of uploaded file
 */
async function uploadToMinIO(filePath, objectName) {
  try {
    console.log(`📤 Uploading ${filePath} to MinIO as ${objectName}...`);
    
    // Upload file
    await minioClient.fPutObject(BUCKET_NAME, objectName, filePath);
    
    // Generate public URL
    const publicUrl = `http://${minioConfig.endPoint}:${minioConfig.port}/${BUCKET_NAME}/${objectName}`;
    
    console.log(`✅ File uploaded successfully: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('❌ Error uploading to MinIO:', error);
    throw error;
  }
}

/**
 * Delete file from MinIO
 * @param {string} objectName - Object name in MinIO
 */
async function deleteFromMinIO(objectName) {
  try {
    await minioClient.removeObject(BUCKET_NAME, objectName);
    console.log(`🗑️ Deleted ${objectName} from MinIO`);
  } catch (error) {
    console.error('❌ Error deleting from MinIO:', error);
    throw error;
  }
}

/**
 * List all recordings in MinIO
 * @returns {Promise<Array>} - List of recording objects
 */
async function listRecordings() {
  try {
    const recordings = [];
    const stream = minioClient.listObjects(BUCKET_NAME, '', true);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        recordings.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
          url: `http://${minioConfig.endPoint}:${minioConfig.port}/${BUCKET_NAME}/${obj.name}`
        });
      });
      
      stream.on('end', () => {
        resolve(recordings);
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('❌ Error listing recordings:', error);
    throw error;
  }
}

/**
 * Get file stats from MinIO
 * @param {string} objectName - Object name in MinIO
 * @returns {Promise<Object>} - File stats
 */
async function getFileStats(objectName) {
  try {
    const stats = await minioClient.statObject(BUCKET_NAME, objectName);
    return {
      size: stats.size,
      lastModified: stats.lastModified,
      etag: stats.etag
    };
  } catch (error) {
    console.error('❌ Error getting file stats:', error);
    throw error;
  }
}

module.exports = {
  minioClient,
  BUCKET_NAME,
  initializeBucket,
  uploadToMinIO,
  deleteFromMinIO,
  listRecordings,
  getFileStats
};