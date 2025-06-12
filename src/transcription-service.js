const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
// Import AWS SDK v3 modules
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } = require('@aws-sdk/client-transcribe');
require('dotenv').config();

// Create a temporary directory for downloaded audio files
const TEMP_DIR = path.join(os.tmpdir(), 'audio-transcriptions');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Get AWS configuration from environment variables
 * @returns {Object} AWS configuration object
 */
function getAWSConfig() {
  const config = {
    region: process.env.AWS_REGION || 'us-west-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY
    }
  };

  console.log('AWS SDK configured with credentials');
  return config;
}

/**
 * Extract bucket name and key from S3 URL
 * @param {string} url - The S3 URL
 * @returns {Object} - The bucket and key
 */
function parseS3Url(url) {
  try {
    const urlObj = new URL(url);
    let bucket, key;

    // Path-style URL: https://s3.region.amazonaws.com/bucket-name/key
    if (urlObj.hostname.startsWith('s3.')) {
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      bucket = pathParts[0];
      key = pathParts.slice(1).join('/');
    } 
    // Virtual-hosted-style URL: https://bucket-name.s3.region.amazonaws.com/key
    else {
      bucket = urlObj.hostname.split('.')[0];
      key = urlObj.pathname.substring(1); // Remove leading slash
    }

    if (!bucket || !key) {
      throw new Error('Could not determine bucket or key from URL.');
    }

    console.log(`Successfully parsed S3 URL - Bucket: ${bucket}, Key: ${key}`);
    return { bucket, key };

  } catch (error) {
    console.error(`Failed to parse S3 URL "${url}":`, error.message);
    // Return a value that indicates failure but doesn't crash the app
    return { bucket: null, key: null };
  }
}

/**
 * Download an audio file from a URL
 * @param {string} url - The URL of the audio file
 * @returns {Promise<string>} - The path to the downloaded file
 */
async function downloadAudio(url) {
  // Check if this is an S3 URL that needs AWS SDK
  if (url.includes('s3.amazonaws.com') || url.includes('s3.us-west-2.amazonaws.com')) {
    console.log('S3 URL detected. Using AWS SDK v3 to download.');

    // Get AWS configuration and parse URL
    const awsConfig = getAWSConfig();
    const { bucket, key } = parseS3Url(url);

    if (!bucket || !key) {
      throw new Error('Could not parse S3 URL correctly');
    }

    // Create S3 client and set up parameters
    const s3Client = new S3Client(awsConfig);
    const params = { Bucket: bucket, Key: key };
    
    // Retry logic to handle S3 propagation delay
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2500; // 2.5 seconds

    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        console.log(`Attempt ${i + 1}/${MAX_RETRIES} to fetch S3 object from bucket: ${bucket}, key: ${key}`);
        const command = new GetObjectCommand(params);
        const response = await s3Client.send(command);

        // Create a unique filename and write the file to disk
        const filename = `s3-recording-${Date.now()}.wav`;
        const filePath = path.join(TEMP_DIR, filename);
        const buffer = await response.Body.transformToByteArray();
        fs.writeFileSync(filePath, buffer);
        console.log(`S3 audio downloaded to ${filePath}`);

        return filePath; // Success
      } catch (error) {
        // Check if the error is "NoSuchKey" and if we can still retry
        if (error.name === 'NoSuchKey' && i < MAX_RETRIES - 1) {
          console.warn(`S3 object not found (key: ${key}), retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          // If it's a different error or the last retry, re-throw to be caught by the caller
          console.error(`Failed to download from S3 after ${i + 1} attempts. Error: ${error.message}`);
          throw error;
        }
      }
    }
  }

  // Fallback for non-S3 URLs
  try {
    console.log(`Downloading audio from ${url}`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer'
    });

    const filename = `recording-${Date.now()}.wav`;
    const filePath = path.join(TEMP_DIR, filename);
    fs.writeFileSync(filePath, response.data);
    console.log(`Audio downloaded to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error downloading audio:', error.message);
    // Re-throw the error to allow the calling function to handle it
    throw error;
  }
}

/**
 * Transcribe an audio file using Amazon Transcribe
 * @param {string} mediaUri - The URI of the audio file
 * @returns {Promise<string>} - The transcription text
 */
async function transcribeAudioWithAmazon(mediaUri) {
  let s3Key = ''; // To store the key of a temporary S3 object we create
  let isTempS3Object = false; // Flag if we created a temp S3 object
  let downloadedFilePath = null; // To store path of a temporarily downloaded file

  try {
    console.log(`Transcribing audio with Amazon Transcribe: ${mediaUri}`);

    const awsConfig = getAWSConfig();
    const s3Client = new S3Client(awsConfig);
    const transcribeClient = new TranscribeClient(awsConfig);
    const jobName = `transcription-job-${Date.now()}`;
    let finalS3Uri = '';
    let sourceMediaUri = mediaUri; // Keep original for reference

    // If we get an S3 https URL, download it first to bypass potential Transcribe service role issues on the original object.
    if (sourceMediaUri.startsWith('https://') && sourceMediaUri.includes('.s3.us-west-2.amazonaws.com')) {
      console.log('S3 HTTPS URL detected. Downloading locally before starting transcription.');
      downloadedFilePath = await downloadAudio(sourceMediaUri);
      if (!downloadedFilePath) {
        throw new Error('Failed to download audio file from S3.');
      }
      // Now, treat the downloaded file as the source.
      sourceMediaUri = downloadedFilePath;
    }
    
    if (sourceMediaUri.startsWith('s3://')) {
        finalS3Uri = sourceMediaUri;
        isTempS3Object = false; // It's a pre-existing object, don't delete it.
    } else {
      // This is a local file path (either original or just downloaded). Upload it to S3 for Transcribe.
      s3Key = `transcribe-inputs/${path.basename(sourceMediaUri)}`;
      finalS3Uri = `s3://sip-sentinel/${s3Key}`;
      isTempS3Object = true; // We created it, so we should delete it.

      console.log(`Uploading local file to S3 at: ${finalS3Uri}`);
      await s3Client.send(new PutObjectCommand({
        Bucket: 'sip-sentinel',
        Key: s3Key,
        Body: fs.readFileSync(sourceMediaUri),
        ContentType: 'audio/wav'
      }));
    }
    
    console.log(`Starting Amazon Transcribe job: ${jobName} with media URI: ${finalS3Uri}`);
    await transcribeClient.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: 'wav', // Twilio recordings are wav by default
      Media: { MediaFileUri: finalS3Uri },
    }));

    // Poll for job completion with optimized timing
    console.log('Waiting for transcription job to complete...');
    let transcriptionJob;
    let attempts = 0;
    const maxAttempts = 20; // ~90 seconds max wait
    const maxWaitTime = 80000; // 80 seconds max wait time, leaving buffer for Vercel
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      // Check if we've exceeded our time limit
      if (Date.now() - startTime > maxWaitTime) {
        console.log('Transcription job exceeded time limit, falling back to simulated transcription');
        // Return a simulated message to allow the flow to continue
        return `(Transcription timed out after ${maxWaitTime / 1000}s)`;
      }

      const getJobCommand = new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName
      });
      transcriptionJob = await transcribeClient.send(getJobCommand);

      const status = transcriptionJob.TranscriptionJob.TranscriptionJobStatus;
      console.log(`Transcription job status: ${status} (attempt ${attempts + 1}/${maxAttempts}) - ${Date.now() - startTime}ms elapsed`);

      if (status === 'COMPLETED') {
        break;
      } else if (status === 'FAILED') {
        throw new Error(`Transcription job failed: ${transcriptionJob.TranscriptionJob.FailureReason}`);
      }

      // Progressive backoff: wait longer as we poll
      const waitTime = 3000 + Math.floor(attempts / 3) * 1000; // Start at 3s, increase to 4s, 5s, etc.
      await new Promise(resolve => setTimeout(resolve, waitTime));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.log('Transcription job polling exceeded max attempts, falling back to simulated transcription');
      return `(Transcription timed out after ${maxAttempts} attempts)`;
    }

    // Get the transcription results
    const transcriptUri = transcriptionJob.TranscriptionJob.Transcript.TranscriptFileUri;
    console.log(`Transcription completed. Downloading results from: ${transcriptUri}`);

    // Download the transcription results
    const response = await axios.get(transcriptUri);
    const transcriptionResults = response.data;

    // Extract the transcription text
    const transcriptionText = transcriptionResults.results.transcripts[0].transcript;
    console.log(`Amazon Transcribe result: "${transcriptionText}"`);

    return transcriptionText;
  } catch (error) {
    console.error('Error with Amazon Transcribe:', error.message);
    // If the job failed, include the failure reason in the returned message
    if (error.message.includes('Transcription job failed:')) {
      return `(Transcription failed: ${error.message.split('Transcription job failed: ')[1]})`;
    }
    return `(Transcription failed: ${error.message})`;
  } finally {
    // Clean up temporary S3 file if we created one
    if (isTempS3Object && s3Key) {
      try {
        console.log(`Cleaning up temporary S3 object: s3://sip-sentinel/${s3Key}`);
        const deleteCommand = new DeleteObjectCommand({
          Bucket: 'sip-sentinel',
          Key: s3Key,
        });
        // Use a new client instance for cleanup to avoid issues with ongoing connections
        await new S3Client(getAWSConfig()).send(deleteCommand);
      } catch (cleanupError) {
        console.error(`Failed to clean up temporary S3 object s3://sip-sentinel/${s3Key}:`, cleanupError.message);
      }
    }

    // Clean up the local file if we downloaded one
    if (downloadedFilePath) {
      try {
        fs.unlinkSync(downloadedFilePath);
        console.log(`Cleaned up temporary local file: ${downloadedFilePath}`);
      } catch (cleanupError) {
        console.error(`Failed to clean up temporary file ${downloadedFilePath}:`, cleanupError.message);
      }
    }
  }
}

/**
 * Transcribe audio from a URL
 * @param {string} audioUrl - The URL of the audio file
 * @param {string} callSid - Optional Twilio call SID for storing in S3
 * @param {string} recordingSid - Optional Twilio recording SID for storing in S3
 * @returns {Promise<string>} - The transcription text
 */
async function transcribeAudioFromUrl(audioUrl, callSid = null, recordingSid = null) {
  try {
    console.log(`Transcribing audio from URL: ${audioUrl}`);

    // If it's an S3 URL, we can pass it directly to the transcription function
    if (audioUrl.includes('.s3.us-west-2.amazonaws.com')) {
      const transcriptionText = await transcribeAudioWithAmazon(audioUrl);
      return { text: transcriptionText, source: 'amazon_s3_direct' };
    }

    // For other URLs, download first
    const audioFilePath = await downloadAudio(audioUrl);
    if (!audioFilePath) {
      throw new Error('Failed to download audio file.');
    }

    const transcriptionText = await transcribeAudioWithAmazon(audioFilePath);
    fs.unlinkSync(audioFilePath); // Clean up temp file

    return { text: transcriptionText, source: 'amazon_download' };

  } catch (error) {
    console.error('Error in transcription process:', error.message);
    return null;
  }
}

/**
 * Get transcription from S3 or transcribe if not available
 * @param {string} audioUrl - The URL of the audio file
 * @param {string} callSid - Twilio call SID
 * @param {string} recordingSid - Twilio recording SID
 * @returns {Promise<string>} - The transcription text
 */
async function getOrCreateTranscription(audioUrl, callSid, recordingSid) {
  try {
    // Import the S3 storage service
    const { getTranscription } = require('./s3-storage-service');

    // Try to get the transcription from S3 first
    const existingTranscription = await getTranscription(callSid, recordingSid);

    if (existingTranscription) {
      console.log(`Found existing transcription for recording ${recordingSid} in S3`);
      return existingTranscription;
    }

    // If not found in S3, transcribe the audio and store it
    console.log(`No existing transcription found for recording ${recordingSid}, creating new one`);
    return await transcribeAudioFromUrl(audioUrl, callSid, recordingSid);
  } catch (error) {
    console.error('Error getting or creating transcription:', error.message);
    // Fall back to regular transcription without S3 storage
    return await transcribeAudioFromUrl(audioUrl);
  }
}

module.exports = {
  transcribeAudioFromUrl,
  getOrCreateTranscription
};
