const axios = require('axios');

const API_BASE = 'http://localhost:3003';

// Test configuration
const TEST_CONFIG = {
    slideUrl: 'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    timings: [3, 6, 9, 12]
};

async function testMinIOAPI() {
    console.log('🚀 Testing Google Slides Recording API with MinIO Storage\n');
    
    try {
        // 1. Health Check
        console.log('1. Checking API health and MinIO connection...');
        const healthResponse = await axios.get(`${API_BASE}/health`);
        console.log('✅ Health Status:', healthResponse.data.status);
        console.log('   Dependencies:', healthResponse.data.dependencies);
        console.log('   MinIO Status:', healthResponse.data.minio.status);
        console.log('   MinIO Endpoint:', healthResponse.data.minio.endpoint);
        console.log('   MinIO Bucket:', healthResponse.data.minio.bucket);
        console.log('   Active Recordings:', healthResponse.data.system.activeRecordings);
        console.log();
        
        if (healthResponse.data.status !== 'healthy') {
            console.log('❌ API is not healthy. Please check dependencies.');
            return;
        }
        
        if (healthResponse.data.minio.status !== 'connected') {
            console.log('❌ MinIO is not connected. Please check MinIO server and configuration.');
            console.log('   Make sure MinIO is running on:', healthResponse.data.minio.endpoint);
            return;
        }
        
        // 2. Start Recording
        console.log('2. Starting recording with MinIO upload...');
        console.log('   URL:', TEST_CONFIG.slideUrl);
        console.log('   Timings:', TEST_CONFIG.timings);
        
        const recordResponse = await axios.post(`${API_BASE}/record`, TEST_CONFIG);
        console.log('✅ Recording started!');
        console.log('   Recording ID:', recordResponse.data.recordingId);
        console.log('   Estimated Duration:', recordResponse.data.estimatedDuration, 'seconds');
        console.log('   Storage: MinIO');
        console.log();
        
        const recordingId = recordResponse.data.recordingId;
        
        // 3. Monitor Progress
        console.log('3. Monitoring recording progress...');
        let completed = false;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes max
        
        while (!completed && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
            attempts++;
            
            try {
                const statusResponse = await axios.get(`${API_BASE}/recording/${recordingId}`);
                const status = statusResponse.data;
                
                console.log(`   [${attempts}] Status: ${status.status}`);
                
                if (status.ffmpegOutput) {
                    console.log(`   Progress: ${status.ffmpegOutput}`);
                }
                
                if (status.status === 'uploading_to_minio') {
                    console.log('   📤 Uploading to MinIO...');
                }
                
                if (status.status === 'completed') {
                    console.log('✅ Recording completed and uploaded to MinIO!');
                    console.log('   File Size:', status.fileSizeMB, 'MB');
                    console.log('   MinIO URL:', status.downloadUrl);
                    console.log('   Object Name:', status.minioObjectName);
                    completed = true;
                } else if (status.status === 'failed') {
                    console.log('❌ Recording failed:', status.error);
                    return;
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.log('   Recording completed, checking recordings list...');
                    completed = true;
                } else {
                    console.log('   Error checking status:', error.message);
                }
            }
        }
        
        if (!completed && attempts >= maxAttempts) {
            console.log('⏰ Recording is taking longer than expected. Check manually.');
        }
        
        // 4. List Recordings from MinIO
        console.log('\n4. Listing all recordings from MinIO...');
        const listResponse = await axios.get(`${API_BASE}/recordings`);
        console.log('✅ Found', listResponse.data.count, 'recordings in MinIO');
        console.log('   Total Size:', listResponse.data.totalSizeMB, 'MB');
        console.log('   Storage:', listResponse.data.storage);
        
        if (listResponse.data.recordings.length > 0) {
            console.log('   Latest recordings:');
            listResponse.data.recordings.slice(0, 3).forEach((rec, i) => {
                console.log(`   ${i + 1}. ${rec.recordingId.slice(0, 8)}... (${rec.fileSizeMB}MB)`);
                console.log(`      URL: ${rec.downloadUrl}`);
            });
        }
        
        // 5. Test direct MinIO URL access
        if (listResponse.data.recordings.length > 0) {
            console.log('\n5. Testing direct MinIO URL access...');
            const latestRecording = listResponse.data.recordings[0];
            try {
                const headResponse = await axios.head(latestRecording.downloadUrl);
                console.log('✅ MinIO URL is accessible');
                console.log('   Content-Type:', headResponse.headers['content-type']);
                console.log('   Content-Length:', headResponse.headers['content-length']);
            } catch (error) {
                console.log('❌ MinIO URL not accessible:', error.message);
                console.log('   This might be due to network configuration or MinIO policy settings');
            }
        }
        
        console.log('\n🎉 MinIO API test completed successfully!');
        
        if (listResponse.data.recordings.length > 0) {
            const latestRecording = listResponse.data.recordings[0];
            console.log(`📹 Your latest recording: ${latestRecording.downloadUrl}`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', error.response.data);
        }
    }
}

// Run test if called directly
if (require.main === module) {
    testMinIOAPI();
}

module.exports = { testMinIOAPI, TEST_CONFIG, API_BASE };