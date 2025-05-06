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

// Verificar se o token do Facebook é válido
async function verifyFacebookToken() {
  try {
    console.log('Verificando token do Facebook...');
    const response = await axios.get(`https://graph.facebook.com/v18.0/me?access_token=${facebookAccessToken}`);
    console.log('Token do Facebook é válido:', response.data);
    return true;
  } catch (error) {
    console.error('Erro ao verificar token do Facebook:');
    console.error('Status:', error.response?.status);
    console.error('Mensagem de erro:', error.response?.data?.error?.message || error.message);
    return false;
  }
}

// Verificar token ao iniciar
verifyFacebookToken().then(isValid => {
  if (!isValid) {
    console.error('ATENÇÃO: O token do Facebook parece ser inválido ou expirado. A aplicação pode não funcionar corretamente.');
  }
});

// Setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware to parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Armazenar os logs para exibir na interface
const appLogs = [];

// Sobrescrever console.log e console.error para capturar os logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function() {
  const args = Array.from(arguments);
  appLogs.push({ type: 'info', message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '), timestamp: new Date() });
  originalConsoleLog.apply(console, args);
};

console.error = function() {
  const args = Array.from(arguments);
  appLogs.push({ type: 'error', message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '), timestamp: new Date() });
  originalConsoleError.apply(console, args);
};

// Rota para obter os logs
app.get('/api/logs', (req, res) => {
  res.json(appLogs);
});

// Root route - serve the HTML page
app.get('/', (req, res) => {
  res.send(htmlContent);
});

// Rota para o CSS
app.get('/styles.css', (req, res) => {
  res.type('text/css').send(cssContent);
});

// Rota para o JavaScript
app.get('/script.js', (req, res) => {
  res.type('text/javascript').send(javascriptContent);
});

// API route to search ads by keyword
app.get('/api/search', async (req, res) => {
  try {
    const { query, searchType } = req.query;
    
    console.log('Search request received:', { query, searchType });
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Search type can be 'keyword' or 'advertiser'
    const type = searchType === 'advertiser' ? 'ADVERTISER_NAME' : 'KEYWORD_UNORDERED';
    
    // Construct the Facebook Ad Library API URL
    const apiUrl = `https://graph.facebook.com/v18.0/ads_archive?access_token=${facebookAccessToken}&ad_type=ALL&ad_active_status=ALL&ad_reached_countries=BR&search_terms=${encodeURIComponent(query)}&search_type=${type}&fields=id,ad_creation_time,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_creative_link_captions,page_name,page_id,funding_entity,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,ad_creative_link_url,ad_creative_images,ad_creative_videos`;
    
    console.log('Calling Facebook API with URL:', apiUrl.replace(facebookAccessToken, 'TOKEN_HIDDEN'));
    
    const response = await axios.get(apiUrl);
    
    console.log('Facebook API response:', JSON.stringify(response.data, null, 2));
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching ads:');
    console.error('Status:', error.response?.status);
    console.error('Status Text:', error.response?.statusText);
    console.error('Error Data:', error.response?.data);
    console.error('Error Message:', error.message);
    
    res.status(500).json({ 
      error: 'Failed to search ads', 
      details: error.response?.data || error.message,
      statusCode: error.response?.status
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

// HTML content
const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facebook Ads Downloader</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
    <div class="container">
      <a class="navbar-brand" href="#">Facebook Ads Downloader</a>
      <div class="d-flex">
        <a href="/logs" class="btn btn-outline-light btn-sm">Ver Logs</a>
      </div>
    </div>
  </nav>

  <div class="container mt-4">
    <div class="row">
      <div class="col-md-12">
        <div class="card">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">Pesquisar Anúncios</h5>
          </div>
          <div class="card-body">
            <form id="searchForm">
              <div class="row mb-3">
                <div class="col-md-8">
                  <label for="searchQuery" class="form-label">Termo de Pesquisa</label>
                  <input type="text" class="form-control" id="searchQuery" placeholder="Digite uma palavra-chave ou nome do anunciante" required>
                </div>
                <div class="col-md-4">
                  <label for="searchType" class="form-label">Tipo de Pesquisa</label>
                  <select class="form-select" id="searchType">
                    <option value="keyword">Por Palavra-chave</option>
                    <option value="advertiser">Por Nome do Anunciante</option>
                  </select>
                </div>
              </div>
              <button type="submit" class="btn btn-primary">
                <i class="bi bi-search"></i> Pesquisar
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <div class="row mt-4" id="resultsSection" style="display: none;">
      <div class="col-md-12">
        <div class="card">
          <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
            <h5 class="mb-0">Resultados da Pesquisa</h5>
            <div>
              <button id="selectAllBtn" class="btn btn-sm btn-light me-2">
                <i class="bi bi-check-all"></i> Selecionar Todos
              </button>
              <button id="downloadBtn" class="btn btn-sm btn-light" disabled>
                <i class="bi bi-download"></i> Baixar Selecionados
              </button>
            </div>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label for="downloadType" class="form-label">O que baixar:</label>
              <select class="form-select form-select-sm w-auto" id="downloadType">
                <option value="all">Tudo (Imagens, Vídeos, Texto, Links)</option>
                <option value="images">Apenas Imagens</option>
                <option value="videos">Apenas Vídeos</option>
                <option value="text">Apenas Texto e Links</option>
              </select>
            </div>
            
            <div id="resultsContainer" class="row g-3"></div>
            
            <div id="noResults" class="alert alert-info mt-3" style="display: none;">
              Nenhum anúncio encontrado para esta pesquisa.
            </div>
            
            <div id="loadingResults" class="text-center py-5" style="display: none;">
              <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Carregando...</span>
              </div>
              <p class="mt-2">Buscando anúncios...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="modal fade" id="downloadModal" tabindex="-1" aria-labelledby="downloadModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-primary text-white">
            <h5 class="modal-title" id="downloadModalLabel">Download em Andamento</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="text-center py-4">
              <div class="spinner-border text-primary mb-3" role="status">
                <span class="visually-hidden">Baixando...</span>
              </div>
              <p id="downloadStatus">Baixando arquivos selecionados...</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="modal fade" id="downloadCompleteModal" tabindex="-1" aria-labelledby="downloadCompleteModalLabel" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header bg-success text-white">
            <h5 class="modal-title" id="downloadCompleteModalLabel">Download Concluído</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p id="downloadCompleteMessage">Os arquivos foram baixados com sucesso!</p>
            <p>Os arquivos estão disponíveis na pasta: <code id="downloadPath"></code></p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fechar</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="script.js"></script>
</body>
</html>`;

// CSS content
const cssContent = `/* General styles */
body {
  background-color: #f8f9fa;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

.card {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
}

.card-header {
  font-weight: 500;
}

/* Ad result card styles */
.ad-card {
  transition: all 0.2s ease;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  height: 100%;
}

.ad-card:hover {
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(-3px);
}

.ad-card .card-body {
  padding: 15px;
}

.ad-card .card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  line-height: 1.4;
}

.ad-card .card-text {
  font-size: 14px;
  color: #6c757d;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 12px;
}

.ad-image-container {
  position: relative;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  overflow: hidden;
  background-color: #e9ecef;
}

.ad-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ad-video-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 1;
}

.ad-checkbox-container {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 1;
}

.ad-checkbox {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.ad-date {
  font-size: 12px;
  color: #6c757d;
  margin-bottom: 8px;
}

.ad-advertiser {
  font-weight: 600;
  margin-bottom: 5px;
  font-size: 15px;
}

.ad-link {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  margin-bottom: 10px;
}

/* Loading spinner */
.spinner-border {
  height: 3rem;
  width: 3rem;
}

/* Responsive adjustments */
@media (max-width: 767.98px) {
  .ad-card .card-title {
    font-size: 15px;
  }
  
  .ad-card .card-text {
    font-size: 13px;
  }
  
  .ad-checkbox {
    width: 18px;
    height: 18px;
  }
}`;

// JavaScript content
const javascriptContent = `document.addEventListener('DOMContentLoaded', () => {
  // DOM elements
  const searchForm = document.getElementById('searchForm');
  const searchQuery = document.getElementById('searchQuery');
  const searchType = document.getElementById('searchType');
  const resultsSection = document.getElementById('resultsSection');
  const resultsContainer = document.getElementById('resultsContainer');
  const noResults = document.getElementById('noResults');
  const loadingResults = document.getElementById('loadingResults');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadType = document.getElementById('downloadType');
  
  // Bootstrap modals
  const downloadModal = new bootstrap.Modal(document.getElementById('downloadModal'));
  const downloadCompleteModal = new bootstrap.Modal(document.getElementById('downloadCompleteModal'));
  
  // Store the search results data
  let searchResults = [];
  
  // Event listeners
  searchForm.addEventListener('submit', performSearch);
  selectAllBtn.addEventListener('click', toggleSelectAll);
  downloadBtn.addEventListener('click', downloadSelectedAds);
  
  // Search for ads via the API
  async function performSearch(e) {
    e.preventDefault();
    
    const query = searchQuery.value.trim();
    const type = searchType.value;
    
    if (!query) {
      alert('Por favor, digite um termo de pesquisa.');
      return;
    }
    
    // Show loading state
    resultsSection.style.display = 'block';
    resultsContainer.innerHTML = '';
    noResults.style.display = 'none';
    loadingResults.style.display = 'block';
    downloadBtn.disabled = true;
    
    try {
      const response = await fetch(\`/api/search?query=\${encodeURIComponent(query)}&searchType=\${type}\`);
      const data = await response.json();
      
      // Hide loading
      loadingResults.style.display = 'none';
      
      if (data.data && data.data.length > 0) {
        searchResults = data.data;
        displayResults(searchResults);
      } else {
        noResults.style.display = 'block';
        searchResults = [];
      }
    } catch (error) {
      loadingResults.style.display = 'none';
      console.error('Error searching for ads:', error);
      resultsContainer.innerHTML = \`
        <div class="col-12">
          <div class="alert alert-danger">
            Erro ao buscar anúncios. Por favor, tente novamente.
          </div>
        </div>
      \`;
    }
  }
  
  // Display search results in the UI
  function displayResults(ads) {
    resultsContainer.innerHTML = '';
    
    ads.forEach((ad, index) => {
      const adCard = createAdCard(ad, index);
      resultsContainer.appendChild(adCard);
    });
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.ad-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', updateDownloadButton);
    });
  }
  
  // Create a card element for an ad
  function createAdCard(ad, index) {
    const col = document.createElement('div');
    col.className = 'col-md-4 col-sm-6';
    
    // Format date
    const startDate = ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time).toLocaleDateString('pt-BR') : 'N/A';
    
    // Get ad image or placeholder
    let imageUrl = 'https://via.placeholder.com/300x200?text=Sem+Imagem';
    let hasVideo = false;
    
    if (ad.ad_creative_images && ad.ad_creative_images.length > 0) {
      imageUrl = ad.ad_creative_images[0].url;
    }
    
    if (ad.ad_creative_videos && ad.ad_creative_videos.length > 0) {
      hasVideo = true;
    }
    
    col.innerHTML = \`
      <div class="ad-card">
        <div class="ad-image-container">
          <div class="ad-checkbox-container">
            <input type="checkbox" class="ad-checkbox" data-index="\${index}">
          </div>
          \${hasVideo ? '<div class="ad-video-indicator"><i class="bi bi-play-fill"></i> Vídeo</div>' : ''}
          <img src="\${imageUrl}" class="ad-image" alt="Ad creative">
        </div>
        <div class="card-body">
          <div class="ad-advertiser">\${ad.page_name || 'Anunciante Desconhecido'}</div>
          <div class="ad-date">Data de Início: \${startDate}</div>
          <h5 class="card-title">\${ad.ad_creative_link_titles?.[0] || 'Sem Título'}</h5>
          <p class="card-text">\${ad.ad_creative_bodies?.[0] || 'Sem descrição'}</p>
          <a href="\${ad.ad_creative_link_url || '#'}" class="ad-link" target="_blank">\${ad.ad_creative_link_url || ''}</a>
          <div class="d-flex justify-content-between">
            <a href="\${ad.ad_snapshot_url}" class="btn btn-sm btn-outline-primary" target="_blank">
              <i class="bi bi-eye"></i> Ver no Facebook
            </a>
            <small class="text-muted">ID: \${ad.id.substring(0, 8)}...</small>
          </div>
        </div>
      </div>
    \`;
    
    return col;
  }
  
  // Toggle select all checkboxes
  function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.ad-checkbox');
    const anyUnchecked = Array.from(checkboxes).some(checkbox => !checkbox.checked);
    
    checkboxes.forEach(checkbox => {
      checkbox.checked = anyUnchecked;
    });
    
    updateDownloadButton();
  }
  
  // Update download button state based on checkbox selection
  function updateDownloadButton() {
    const checkedBoxes = document.querySelectorAll('.ad-checkbox:checked');
    downloadBtn.disabled = checkedBoxes.length === 0;
    
    // Update button text with count
    if (checkedBoxes.length > 0) {
      downloadBtn.innerHTML = \`<i class="bi bi-download"></i> Baixar (\${checkedBoxes.length})\`;
    } else {
      downloadBtn.innerHTML = \`<i class="bi bi-download"></i> Baixar Selecionados\`;
    }
  }
  
  // Download selected ads
  async function downloadSelectedAds() {
    const selectedCheckboxes = document.querySelectorAll('.ad-checkbox:checked');
    
    if (selectedCheckboxes.length === 0) {
      return;
    }
    
    // Get selected ads
    const selectedAds = Array.from(selectedCheckboxes).map(checkbox => {
      const index = parseInt(checkbox.dataset.index, 10);
      return searchResults[index];
    });
    
    // Show download modal
    downloadModal.show();
    
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ads: selectedAds,
          downloadType: downloadType.value
        })
      });
      
      const result = await response.json();
      
      // Hide download modal and show completion modal
      downloadModal.hide();
      
      if (result.success) {
        document.getElementById('downloadCompleteMessage').textContent = 
          \`Foram baixados \${selectedAds.length} anúncios com sucesso!\`;
        document.getElementById('downloadPath').textContent = result.batchDir;
        downloadCompleteModal.show();
      } else {
        throw new Error(result.error || 'Failed to download ads');
      }
    } catch (error) {
      downloadModal.hide();
      console.error('Error downloading ads:', error);
      alert(\`Erro ao baixar os anúncios: \${error.message}\`);
    }
  }
});`;

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  
  // Abrir o navegador automaticamente apenas em ambiente de desenvolvimento (não no Render)
  if (process.env.NODE_ENV !== 'production') {
    open(`http://localhost:${port}`);
  }
});

// Página de logs
app.get('/logs', (req, res) => {
  const logsHtml = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logs - Facebook Ads Downloader</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
      .log-error { color: #dc3545; }
      .log-info { color: #0d6efd; }
      .log-container {
        max-height: 500px;
        overflow-y: auto;
        font-family: monospace;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
      <div class="container">
        <a class="navbar-brand" href="/">Facebook Ads Downloader</a>
        <div>
          <a href="/" class="btn btn-outline-light btn-sm">Voltar</a>
        </div>
      </div>
    </nav>

    <div class="container mt-4">
      <div class="card">
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
          <h5 class="mb-0">Logs da Aplicação</h5>
          <button id="refreshBtn" class="btn btn-sm btn-outline-light">Atualizar</button>
        </div>
        <div class="card-body">
          <div id="logContainer" class="log-container border p-3 rounded"></div>
        </div>
      </div>
    </div>

    <script>
      function fetchLogs() {
        fetch('/api/logs')
          .then(response => response.json())
          .then(logs => {
            const container = document.getElementById('logContainer');
            container.innerHTML = '';
            
            if (logs.length === 0) {
              container.innerHTML = '<p class="text-muted">Nenhum log disponível.</p>';
              return;
            }
            
            logs.forEach(log => {
              const logElement = document.createElement('div');
              logElement.className = \`log-\${log.type}\`;
              const time = new Date(log.timestamp).toLocaleTimeString();
              logElement.innerHTML = \`[\${time}] \${log.message}\`;
              container.appendChild(logElement);
            });
            
            // Rolar para o final
            container.scrollTop = container.scrollHeight;
          })
          .catch(error => {
            console.error('Erro ao buscar logs:', error);
            document.getElementById('logContainer').innerHTML = 
              \`<p class="text-danger">Erro ao carregar logs: \${error.message}</p>\`;
          });
      }
      
      // Carregar logs ao iniciar
      document.addEventListener('DOMContentLoaded', fetchLogs);
      
      // Configurar botão de atualização
      document.getElementById('refreshBtn').addEventListener('click', fetchLogs);
      
      // Atualizar logs a cada 5 segundos
      setInterval(fetchLogs, 5000);
    </script>
  </body>
  </html>
  `;
  
  res.send(logsHtml);
}); 