const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const open = require('open');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const config = require('./config');

// Criar diretórios necessários se não existirem
const ensureDirectoryExists = (directory) => {
  if (!fs.existsSync(directory)) {
    console.log(`Criando diretório: ${directory}`);
    fs.mkdirSync(directory, { recursive: true });
  }
};

// Garantir que as pastas necessárias existam
ensureDirectoryExists(path.join(__dirname, 'public'));
ensureDirectoryExists(path.join(__dirname, 'downloads'));
ensureDirectoryExists(path.join(__dirname, 'uploads'));

const app = express();
const port = process.env.PORT || config.port;

// Token de acesso do Facebook (prioriza a variável de ambiente)
const facebookAccessToken = process.env.FACEBOOK_ACCESS_TOKEN || config.facebookAccessToken;

// Setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware to parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route - serve the HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API route to search ads by keyword
app.get('/api/search', async (req, res) => {
  try {
    const { query, searchType } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Search type can be 'keyword' or 'advertiser'
    const type = searchType === 'advertiser' ? 'ADVERTISER_NAME' : 'KEYWORD_UNORDERED';
    
    // Construct the Facebook Ad Library API URL
    const apiUrl = `https://graph.facebook.com/v18.0/ads_archive?access_token=${facebookAccessToken}&ad_type=ALL&ad_active_status=ALL&country=BR&search_terms=${encodeURIComponent(query)}&search_type=${type}&fields=id,ad_creation_time,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_creative_link_captions,page_name,page_id,funding_entity,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,ad_creative_link_url,ad_creative_images,ad_creative_videos`;
    
    const response = await axios.get(apiUrl);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching ads:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to search ads', 
      details: error.response?.data || error.message 
    });
  }
});

// API route to download ad assets (images, videos)
app.post('/api/download', async (req, res) => {
  try {
    const { ads, downloadType } = req.body;
    
    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({ error: 'No ads selected for download' });
    }
    
    // Create a downloads directory if it doesn't exist
    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
    }
    
    // Create a timestamp for this batch of downloads
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const batchDir = path.join(downloadsDir, `batch-${timestamp}`);
    fs.mkdirSync(batchDir);
    
    // Create a metadata file with all the ad information
    const metadata = {
      downloadDate: new Date().toISOString(),
      ads: ads.map(ad => ({
        id: ad.id,
        pageName: ad.page_name,
        adCreativeBody: ad.ad_creative_bodies?.[0],
        adCreativeLinkTitle: ad.ad_creative_link_titles?.[0],
        adCreativeLinkDescription: ad.ad_creative_link_descriptions?.[0],
        adCreativeLinkUrl: ad.ad_creative_link_url,
        adSnapshotUrl: ad.ad_snapshot_url,
        adDeliveryStartTime: ad.ad_delivery_start_time,
        adDeliveryStopTime: ad.ad_delivery_stop_time
      }))
    };
    
    fs.writeFileSync(
      path.join(batchDir, 'metadata.json'), 
      JSON.stringify(metadata, null, 2)
    );
    
    // Download files based on the download type (all, images, videos)
    const downloadPromises = [];
    
    for (const ad of ads) {
      // Download images if requested
      if (downloadType === 'all' || downloadType === 'images') {
        if (ad.ad_creative_images && ad.ad_creative_images.length > 0) {
          for (let i = 0; i < ad.ad_creative_images.length; i++) {
            const image = ad.ad_creative_images[i];
            if (image.url) {
              downloadPromises.push(
                downloadFile(
                  image.url,
                  path.join(batchDir, `${ad.id}_image_${i}.jpg`)
                )
              );
            }
          }
        }
      }
      
      // Download videos if requested
      if (downloadType === 'all' || downloadType === 'videos') {
        if (ad.ad_creative_videos && ad.ad_creative_videos.length > 0) {
          for (let i = 0; i < ad.ad_creative_videos.length; i++) {
            const video = ad.ad_creative_videos[i];
            if (video.video_url) {
              downloadPromises.push(
                downloadFile(
                  video.video_url,
                  path.join(batchDir, `${ad.id}_video_${i}.mp4`)
                )
              );
            }
          }
        }
      }
    }
    
    // Wait for all downloads to complete
    await Promise.all(downloadPromises);
    
    // Create a ZIP file of all downloads (in a real app)
    // For now, just return the path to the batch directory
    res.json({
      success: true,
      message: `Downloaded ${downloadPromises.length} files`,
      batchDir: batchDir
    });
  } catch (error) {
    console.error('Error downloading ads:', error);
    res.status(500).json({ 
      error: 'Failed to download ads', 
      details: error.message 
    });
  }
});

// Helper function to download a file from a URL
async function downloadFile(url, outputPath) {
  try {
    const response = await fetch(url);
    const fileStream = fs.createWriteStream(outputPath);
    
    return new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
    });
  } catch (error) {
    console.error(`Error downloading file from ${url}:`, error);
    throw error;
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  
  // Abrir o navegador automaticamente apenas em ambiente de desenvolvimento (não no Render)
  if (process.env.NODE_ENV !== 'production') {
    open(`http://localhost:${port}`);
  }
}); 