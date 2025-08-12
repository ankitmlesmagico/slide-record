const axios = require('axios');

const API_BASE = 'http://localhost:3003';

// Test configuration
const TEST_CONFIG = {
    slideUrl: 'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit', // Example public slides
    timings: [3, 6, 9, 12] // Advance slides at these seconds
};

async function testAPI() {
    console.log('🚀 Testing Google Slides Recording API\n');
    
    try {
        // 1. Health Check
        console.log('1. Checking API health...');
        const healthResponse = await axios.get(`${API_BASE}/health`);
        console.log('✅ Health Status:', healthResponse.data.status);
        console.log('   Dependencies:', healthResponse.data.dependencies);
        console.log('   Active Recordings:', healthResponse.data.system.activeRecordings);
        console.log();
        
        if (healthResponse.data.status !== 'healthy') {
            console.log('❌ API is not healthy. Please check dependencies.');
            return;
        }
        
        // 2. Start Recording
        console.log('2. Starting recording...');
        console.log('   URL:', TEST_CONFIG.slideUrl);
        console.log('   Timings:', TEST_CONFIG.timings);
        
        const recordResponse = await axios.post(`${API_BASE}/record`, TEST_CONFIG);
        console.log('✅ Recording started!');
        console.log('   Recording ID:', recordResponse.data.recordingId);
        console.log('   Estimated Duration:', recordResponse.data.estimatedDuration, 'seconds');
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
                
                if (status.status === 'completed') {
                    console.log('✅ Recording completed!');
                    console.log('   File Size:', status.fileSizeMB, 'MB');
                    console.log('   Download URL:', `${API_BASE}${status.downloadUrl}`);
                    completed = true;
                } else if (status.status === 'failed') {
                    console.log('❌ Recording failed:', status.error);
                    return;
                }
            } catch (error) {
                console.log('   Error checking status:', error.message);
            }
        }
        
        if (!completed) {
            console.log('⏰ Recording is taking longer than expected. Check manually.');
            return;
        }
        
        // 4. List Recordings
        console.log('\n4. Listing all recordings...');
        const listResponse = await axios.get(`${API_BASE}/recordings`);
        console.log('✅ Found', listResponse.data.count, 'recordings');
        console.log('   Total Size:', listResponse.data.totalSizeMB, 'MB');
        
        if (listResponse.data.recordings.length > 0) {
            console.log('   Latest recordings:');
            listResponse.data.recordings.slice(0, 3).forEach((rec, i) => {
                console.log(`   ${i + 1}. ${rec.recordingId.slice(0, 8)}... (${rec.fileSizeMB}MB)`);
            });
        }
        
        console.log('\n🎉 API test completed successfully!');
        console.log(`📹 Your recording: ${API_BASE}/recordings/slideshow_${recordingId}.mp4`);
        
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
    testAPI();
}

module.exports = { testAPI, TEST_CONFIG, API_BASE };