/**
 * S3 Storage Service for call data and transcriptions
 * This service handles storing and retrieving call data from S3
 */
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
require('dotenv').config();

// S3 bucket name
const BUCKET_NAME = 'sip-sentinel';

// Folder structure in S3
const FOLDERS = {
  RECORDINGS: 'recordings',
  TRANSCRIPTIONS: 'transcriptions',
  METADATA: 'metadata'
};

/**
 * Get AWS configuration from environment variables
 * @returns {Object} AWS configuration object
 */
function getAWSConfig() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.warn('AWS credentials not found in environment variables');
    return null;
  }

  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  };

  console.log('AWS SDK configured with credentials');
  return config;
}

/**
 * Create an S3 client
 * @returns {S3Client} S3 client
 */
function createS3Client() {
  const awsConfig = getAWSConfig();
  if (!awsConfig) {
    throw new Error('AWS credentials not configured');
  }
  return new S3Client(awsConfig);
}

/**
 * Store call metadata in S3
 * @param {string} callSid - The Twilio call SID
 * @param {Object} metadata - The call metadata to store
 * @returns {Promise<string>} - The S3 key where the metadata was stored
 */
async function storeCallMetadata(callSid, metadata) {
  try {
    console.log(`Storing metadata for call ${callSid} in S3`);
    
    // Create S3 client
    const s3Client = createS3Client();
    
    // Create a unique key for the metadata
    const key = `${FOLDERS.METADATA}/${callSid}.json`;
    
    // Add timestamp to metadata
    const metadataWithTimestamp = {
      ...metadata,
      timestamp: new Date().toISOString(),
      callSid
    };
    
    // Upload the metadata to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(metadataWithTimestamp, null, 2),
      ContentType: 'application/json'
    };
    
    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`Metadata stored in S3: s3://${BUCKET_NAME}/${key}`);
    
    return key;
  } catch (error) {
    console.error('Error storing call metadata in S3:', error);
    throw error;
  }
}

/**
 * Store transcription in S3
 * @param {string} callSid - The Twilio call SID
 * @param {string} recordingSid - The Twilio recording SID
 * @param {string} transcriptionText - The transcription text
 * @returns {Promise<string>} - The S3 key where the transcription was stored
 */
async function storeTranscription(callSid, recordingSid, transcriptionText) {
  try {
    console.log(`[S3 STORAGE] Storing transcription for recording ${recordingSid} in S3`);
    console.log(`[S3 STORAGE] Transcription length: ${transcriptionText ? transcriptionText.length : 0} characters`);
    console.log(`[S3 STORAGE] Transcription preview: "${transcriptionText ? transcriptionText.substring(0, 100) : 'null'}..."`);

    // Create S3 client
    const s3Client = createS3Client();

    // Create a unique key for the transcription
    const key = `${FOLDERS.TRANSCRIPTIONS}/${callSid}/${recordingSid}.txt`;

    // Upload the transcription to S3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: transcriptionText,
      ContentType: 'text/plain'
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    console.log(`[S3 STORAGE] Transcription stored in S3: s3://${BUCKET_NAME}/${key}`);

    return key;
  } catch (error) {
    console.error('[S3 STORAGE] Error storing transcription in S3:', error);
    throw error;
  }
}

/**
 * Get call metadata from S3
 * @param {string} callSid - The Twilio call SID
 * @returns {Promise<Object>} - The call metadata
 */
async function getCallMetadata(callSid) {
  try {
    console.log(`Retrieving metadata for call ${callSid} from S3`);
    
    // Create S3 client
    const s3Client = createS3Client();
    
    // Create the key for the metadata
    const key = `${FOLDERS.METADATA}/${callSid}.json`;
    
    // Get the metadata from S3
    const getParams = {
      Bucket: BUCKET_NAME,
      Key: key
    };
    
    const response = await s3Client.send(new GetObjectCommand(getParams));
    
    // Convert the readable stream to a string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const metadataString = buffer.toString('utf-8');
    
    // Parse the metadata
    const metadata = JSON.parse(metadataString);
    console.log(`Retrieved metadata for call ${callSid} from S3`);
    
    return metadata;
  } catch (error) {
    console.error(`Error retrieving metadata for call ${callSid} from S3:`, error);
    return null;
  }
}

/**
 * Get transcription from S3
 * @param {string} callSid - The Twilio call SID
 * @param {string} recordingSid - The Twilio recording SID
 * @returns {Promise<string>} - The transcription text
 */
async function getTranscription(callSid, recordingSid) {
  try {
    console.log(`[S3 RETRIEVAL] Retrieving transcription for recording ${recordingSid} from S3`);

    // Create S3 client
    const s3Client = createS3Client();

    // Create the key for the transcription
    const key = `${FOLDERS.TRANSCRIPTIONS}/${callSid}/${recordingSid}.txt`;

    // Get the transcription from S3
    const getParams = {
      Bucket: BUCKET_NAME,
      Key: key
    };

    const response = await s3Client.send(new GetObjectCommand(getParams));

    // Convert the readable stream to a string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const transcriptionText = buffer.toString('utf-8');

    console.log(`[S3 RETRIEVAL] Retrieved transcription for recording ${recordingSid} from S3`);
    console.log(`[S3 RETRIEVAL] Retrieved transcription length: ${transcriptionText ? transcriptionText.length : 0} characters`);
    console.log(`[S3 RETRIEVAL] Retrieved transcription preview: "${transcriptionText ? transcriptionText.substring(0, 100) : 'null'}..."`);

    return transcriptionText;
  } catch (error) {
    console.error(`[S3 RETRIEVAL] Error retrieving transcription for recording ${recordingSid} from S3:`, error);
    return null;
  }
}

/**
 * Find recording in S3 by recording SID
 * @param {string} recordingSid - The Twilio recording SID
 * @returns {Promise<string|null>} - The S3 key if found, null otherwise
 */
async function findRecordingInS3(recordingSid) {
  try {
    console.log(`[S3 SEARCH] Looking for recording ${recordingSid} in S3`);

    // Create S3 client
    const s3Client = createS3Client();

    // Search in the recordings folder
    const listParams = {
      Bucket: BUCKET_NAME,
      Prefix: `${FOLDERS.RECORDINGS}/`,
      MaxKeys: 1000 // Reasonable limit for search
    };

    const response = await s3Client.send(new ListObjectsV2Command(listParams));

    if (!response.Contents || response.Contents.length === 0) {
      console.log(`[S3 SEARCH] No recordings found in S3 recordings folder`);
      return null;
    }

    // Look for a key that contains the recording SID
    const matchingObject = response.Contents.find(object =>
      object.Key.includes(recordingSid)
    );

    if (matchingObject) {
      console.log(`[S3 SEARCH] Found recording in S3: ${matchingObject.Key}`);
      return matchingObject.Key;
    }

    console.log(`[S3 SEARCH] Recording ${recordingSid} not found in S3`);
    return null;
  } catch (error) {
    console.error(`[S3 SEARCH] Error searching for recording ${recordingSid} in S3:`, error);
    return null;
  }
}

/**
 * List recent call metadata from S3
 * @param {number} limit - Maximum number of items to return
 * @returns {Promise<Array>} - Array of call metadata objects
 */
async function listRecentCallMetadata(limit = 10) {
  try {
    console.log(`Listing recent call metadata from S3 (limit: ${limit})`);

    // Create S3 client
    let s3Client;
    try {
      s3Client = createS3Client();
    } catch (error) {
      console.warn('S3 client not available:', error.message);
      return [];
    }

    // List objects in the metadata folder
    const listParams = {
      Bucket: BUCKET_NAME,
      Prefix: `${FOLDERS.METADATA}/`,
      MaxKeys: limit
    };

    const response = await s3Client.send(new ListObjectsV2Command(listParams));

    // If no objects found, return empty array
    if (!response.Contents || response.Contents.length === 0) {
      console.log('No call metadata found in S3');
      return [];
    }

    // Get metadata for each object
    const metadataPromises = response.Contents.map(async (object) => {
      const getParams = {
        Bucket: BUCKET_NAME,
        Key: object.Key
      };

      const objectResponse = await s3Client.send(new GetObjectCommand(getParams));

      // Convert the readable stream to a string
      const chunks = [];
      for await (const chunk of objectResponse.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const metadataString = buffer.toString('utf-8');

      // Parse the metadata
      return JSON.parse(metadataString);
    });

    const metadataList = await Promise.all(metadataPromises);

    // Sort by timestamp (newest first)
    metadataList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`Retrieved ${metadataList.length} call metadata items from S3`);

    return metadataList;
  } catch (error) {
    console.error('Error listing call metadata from S3:', error);
    return [];
  }
}

module.exports = {
  storeCallMetadata,
  storeTranscription,
  getCallMetadata,
  getTranscription,
  listRecentCallMetadata,
  findRecordingInS3
};
