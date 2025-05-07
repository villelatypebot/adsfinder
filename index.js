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
const port = process.env.PORT || config.port || 3001;

// Token de acesso do Facebook (prioriza a variável de ambiente)
let facebookAccessToken = process.env.FACEBOOK_ACCESS_TOKEN || config.facebookAccessToken;

// Variável para armazenar o token inserido pelo usuário
let userProvidedToken = '';

// Verificar se o token do Facebook é válido
async function verifyFacebookToken(token) {
  try {
    console.log('Verificando token do Facebook...');
    const response = await axios.get(`https://graph.facebook.com/v20.0/me?access_token=${token}`);
    console.log('Token do Facebook é válido:', response.data);
    return true;
  } catch (error) {
    console.error('Erro ao verificar token do Facebook:');
    console.error('Status:', error.response?.status);
    console.error('Mensagem de erro:', error.response?.data?.error?.message || error.message);
    return false;
  }
}

// Será executado quando o usuário submeter um novo token
app.post('/api/set-token', express.json(), async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token não fornecido' });
    }
    
    // Verificar se o token é válido
    const isValid = await verifyFacebookToken(token);
    
    if (isValid) {
      // Salvar o token para uso nas requisições
      userProvidedToken = token;
      return res.json({ success: true, message: 'Token válido e salvo com sucesso!' });
    } else {
      return res.status(400).json({ success: false, message: 'Token inválido ou expirado' });
    }
  } catch (error) {
    console.error('Erro ao definir token:', error);
    return res.status(500).json({ success: false, message: 'Erro ao processar solicitação' });
  }
});

// Verificar token ao iniciar (usando o token do config por padrão)
verifyFacebookToken(facebookAccessToken).then(isValid => {
  if (!isValid) {
    console.warn('ATENÇÃO: O token do Facebook padrão parece ser inválido ou expirado. Por favor, forneça um token válido pela interface da aplicação.');
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
    const { query, searchType, country, limit, adActiveStatus, adType } = req.query;
    
    console.log('Search request received:', { query, searchType, country, limit, adActiveStatus, adType });
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Usar o token fornecido pelo usuário se disponível, caso contrário, usar o token padrão
    const tokenToUse = userProvidedToken || facebookAccessToken;
    
    if (!tokenToUse || tokenToUse === 'REPLACE_WITH_YOUR_NEW_FACEBOOK_ACCESS_TOKEN') {
      return res.status(400).json({ 
        error: 'Token do Facebook não configurado', 
        needToken: true,
        message: 'Por favor, forneça um token de acesso válido do Facebook para continuar.'
      });
    }
    
    // Verificar se o token ainda é válido
    const isValid = await verifyFacebookToken(tokenToUse);
    if (!isValid) {
      return res.status(400).json({ 
        error: 'Token do Facebook inválido ou expirado', 
        needToken: true,
        message: 'Seu token de acesso expirou. Por favor, forneça um novo token.'
      });
    }
    
    // Construir URL base da API - USANDO OS MESMOS PARÂMETROS DA URL DE BIBLIOTECA DE ANÚNCIOS
    // Exemplo: https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&is_targeted_country=false&media_type=all&q=chatbot&search_type=keyword_unordered
    let apiUrl = `https://graph.facebook.com/v20.0/ads_archive?access_token=${tokenToUse}`;
    
    // Adicionar parâmetros de busca
    apiUrl += `&search_terms=${encodeURIComponent(query)}`;
    apiUrl += `&search_type=KEYWORD_UNORDERED`;
    
    // Adicionar limite de resultados
    const resultLimit = parseInt(limit) || 25;
    apiUrl += `&limit=${resultLimit}`;
    
    // Adicionar status do anúncio
    if (adActiveStatus && adActiveStatus !== 'ALL') {
      apiUrl += `&ad_active_status=${adActiveStatus}`;
    } else {
      apiUrl += '&ad_active_status=ACTIVE'; // Usar ACTIVE como padrão, como na URL do Facebook
    }
    
    // Adicionar tipo de anúncio
    if (adType && adType !== 'ALL') {
      apiUrl += `&ad_type=${adType}`;
    } else {
      apiUrl += '&ad_type=ALL';
    }
    
    // O parâmetro de país é obrigatório
    if (country && country !== 'global') {
      // Se for Brasil, garantir que estamos buscando APENAS anúncios do Brasil
      if (country === 'BR') {
        console.log(`Aplicando filtro exclusivo para anúncios do Brasil`);
        apiUrl += `&ad_reached_countries=BR`;
        apiUrl += `&is_targeted_country=false`; // Parâmetro importante da URL original do Facebook
      } else {
        console.log(`Aplicando filtro de país: ${country}`);
        apiUrl += `&ad_reached_countries=${country}`;
      }
    } else {
      // Busca "global" - usar os países mais populares para ampliar resultados
      console.log('Aplicando busca global com múltiplos países');
      apiUrl += '&ad_reached_countries=US,GB,BR,CA,AU,FR,DE,ES,IT,MX';
    }
    
    // Adicionar tipo de mídia (igual à URL original do Facebook)
    apiUrl += '&media_type=ALL';
    
    // Campos completos a serem solicitados da API
    const fields = [
      'id',
      'ad_creation_time',
      'ad_creative_bodies',
      'ad_creative_link_titles',
      'ad_creative_link_descriptions',
      'ad_creative_link_captions',
      'page_name',
      'page_id',
      'ad_delivery_start_time',
      'ad_delivery_stop_time',
      'ad_snapshot_url',
      'ad_creative_link_url',
      // Solicitando imagens com todos os possíveis campos
      'ad_creative_images{url,original_image_url,permalink_url,name,width,height,preview_image_url}',
      'ad_creative_videos{video_url,thumbnail_url,preview_image_url,permalink_url}',
      'targeting{geo_locations}',
      'languages'
    ].join(',');
    
    // Adicionar os campos que queremos recuperar
    apiUrl += `&fields=${fields}`;
    
    console.log('Calling Facebook API with URL:', apiUrl.replace(tokenToUse, 'TOKEN_HIDDEN'));
    
    const response = await axios.get(apiUrl);
    
    console.log('Facebook API response:', JSON.stringify(response.data, null, 2));
    
    // Verificar se há anúncios brasileiros nos resultados
    if (country === 'BR' && response.data && response.data.data && response.data.data.length === 0) {
      console.log('Nenhum anúncio encontrado especificamente para o Brasil, tentando expandir a busca...');
      // Tentar buscar com mais parâmetros flexíveis
      apiUrl = apiUrl.replace('&is_targeted_country=false', '');
      
      console.log('Calling expanded Facebook API with URL:', apiUrl.replace(tokenToUse, 'TOKEN_HIDDEN'));
      
      const expandedResponse = await axios.get(apiUrl);
      console.log('Expanded Facebook API response:', JSON.stringify(expandedResponse.data, null, 2));
      
      res.json(expandedResponse.data);
    } else {
      res.json(response.data);
    }
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
        <button class="btn btn-outline-light btn-sm me-2" data-bs-toggle="modal" data-bs-target="#tokenModal">
          <i class="bi bi-key-fill"></i> Configurar Token
        </button>
        <a href="/logs" class="btn btn-outline-light btn-sm">Ver Logs</a>
      </div>
    </div>
  </nav>

  <div class="container mt-4">
    <div id="tokenAlert" class="alert alert-warning" style="display: none;">
      <i class="bi bi-exclamation-triangle-fill"></i> 
      <strong>Atenção:</strong> Token do Facebook não configurado ou inválido. 
      <button class="btn btn-sm btn-warning ms-2" data-bs-toggle="modal" data-bs-target="#tokenModal">
        Configurar Token
      </button>
    </div>

    <div class="row">
      <div class="col-md-12">
        <div class="card">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">Pesquisar Anúncios</h5>
          </div>
          <div class="card-body">
            <form id="searchForm">
              <div class="row mb-3">
                <div class="col-md-5">
                  <label for="searchQuery" class="form-label">Termo de Pesquisa</label>
                  <input type="text" class="form-control" id="searchQuery" placeholder="Digite uma palavra-chave ou nome do anunciante" required>
                </div>
                <div class="col-md-2">
                  <label for="searchType" class="form-label">Tipo de Pesquisa</label>
                  <select class="form-select" id="searchType">
                    <option value="keyword">Por Palavra-chave</option>
                    <option value="advertiser">Por Nome do Anunciante</option>
                  </select>
                </div>
                <div class="col-md-3">
                  <label for="countryFilter" class="form-label">Filtro de País</label>
                  <select class="form-select" id="countryFilter">
                    <option value="global">Global (Todos os Países)</option>
                    <option value="US">Estados Unidos</option>
                    <option value="BR">Brasil</option>
                    <option value="GB">Reino Unido</option>
                    <option value="ES">Espanha</option>
                    <option value="PT">Portugal</option>
                    <option value="FR">França</option>
                    <option value="DE">Alemanha</option>
                    <option value="IT">Itália</option>
                    <option value="MX">México</option>
                    <option value="CA">Canadá</option>
                  </select>
                </div>
                <div class="col-md-2">
                  <label for="resultLimit" class="form-label">Qtd. Resultados</label>
                  <select class="form-select" id="resultLimit">
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="250">250</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                  </select>
                </div>
              </div>
              <div class="d-flex justify-content-between">
                <button type="submit" class="btn btn-primary">
                  <i class="bi bi-search"></i> Pesquisar
                </button>
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="advancedSearchToggle">
                  <label class="form-check-label" for="advancedSearchToggle">Busca avançada</label>
                </div>
              </div>
              
              <div id="advancedOptions" class="mt-3 p-3 border rounded bg-light" style="display: none;">
                <h6>Opções Avançadas de Busca</h6>
                <div class="row">
                  <div class="col-md-6">
                    <div class="mb-2">
                      <label for="adActiveStatus" class="form-label">Status do Anúncio</label>
                      <select class="form-select form-select-sm" id="adActiveStatus">
                        <option value="ALL">Todos</option>
                        <option value="ACTIVE">Ativos</option>
                        <option value="INACTIVE">Inativos</option>
                      </select>
                    </div>
                  </div>
                  <div class="col-md-6">
                    <div class="mb-2">
                      <label for="adType" class="form-label">Tipo de Anúncio</label>
                      <select class="form-select form-select-sm" id="adType">
                        <option value="ALL">Todos</option>
                        <option value="POLITICAL_AND_ISSUE_ADS">Políticos e de Questões Sociais</option>
                        <option value="HOUSING_ADS">Imobiliários</option>
                        <option value="EMPLOYMENT_ADS">Emprego</option>
                        <option value="CREDIT_ADS">Crédito</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
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
    
    <!-- Token Configuration Modal -->
    <div class="modal fade" id="tokenModal" tabindex="-1" aria-labelledby="tokenModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header bg-primary text-white">
            <h5 class="modal-title" id="tokenModalLabel">Configurar Token do Facebook</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-info">
              <h6><i class="bi bi-info-circle-fill"></i> Como obter seu Token do Facebook:</h6>
              <ol>
                <li>Acesse <a href="https://developers.facebook.com/tools/explorer/" target="_blank">Facebook Graph API Explorer</a></li>
                <li>Selecione seu App no menu suspenso</li>
                <li>Adicione as permissões: <code>ads_read</code>, <code>ads_management</code></li>
                <li>Clique em "Generate Access Token"</li>
                <li>Copie o token gerado e cole abaixo</li>
              </ol>
            </div>
            <div id="tokenResponseMessage" class="alert" style="display: none;"></div>
            <form id="tokenForm">
              <div class="mb-3">
                <label for="facebookToken" class="form-label">Token de Acesso do Facebook</label>
                <input type="text" class="form-control" id="facebookToken" placeholder="Cole seu token de acesso aqui" required>
                <div class="form-text">Este token será armazenado apenas na memória do servidor e não será salvo permanentemente.</div>
              </div>
              <button type="submit" class="btn btn-primary" id="saveTokenBtn">
                <i class="bi bi-save"></i> Salvar e Verificar Token
              </button>
            </form>
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

/* Token modal styles */
#tokenForm .form-control {
  font-family: monospace;
  letter-spacing: 0.5px;
}

#tokenAlert {
  border-left: 4px solid #ffc107;
}

.alert code {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 2px 4px;
  border-radius: 3px;
}

/* Ad result card styles */
.ad-card {
  transition: all 0.2s ease;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ad-card:hover {
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(-3px);
}

.ad-card .card-body {
  padding: 15px;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
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
  flex-grow: 1;
}

.ad-image-container {
  position: relative;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  overflow: hidden;
  background-color: #e9ecef;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>');
  background-repeat: no-repeat;
  background-position: center;
  background-size: 48px;
}

.ad-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.ad-image[src*="placeholder"] {
  object-fit: contain;
  padding: 10px;
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

/* Badges */
.badge {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  margin-left: 5px;
  vertical-align: middle;
}

/* Advanced options toggle */
.form-check-input:checked {
  background-color: #0d6efd;
  border-color: #0d6efd;
}

#advancedOptions {
  transition: all 0.3s ease;
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
  const countryFilter = document.getElementById('countryFilter');
  const resultLimit = document.getElementById('resultLimit');
  const advancedSearchToggle = document.getElementById('advancedSearchToggle');
  const advancedOptions = document.getElementById('advancedOptions');
  const adActiveStatus = document.getElementById('adActiveStatus');
  const adType = document.getElementById('adType');
  const resultsSection = document.getElementById('resultsSection');
  const resultsContainer = document.getElementById('resultsContainer');
  const noResults = document.getElementById('noResults');
  const loadingResults = document.getElementById('loadingResults');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadType = document.getElementById('downloadType');
  const tokenForm = document.getElementById('tokenForm');
  const tokenAlert = document.getElementById('tokenAlert');
  const tokenResponseMessage = document.getElementById('tokenResponseMessage');
  
  // Bootstrap modals
  const tokenModal = new bootstrap.Modal(document.getElementById('tokenModal'));
  const downloadModal = new bootstrap.Modal(document.getElementById('downloadModal'));
  const downloadCompleteModal = new bootstrap.Modal(document.getElementById('downloadCompleteModal'));
  
  // Store the search results data
  let searchResults = [];
  
  // Check if we need to show the token alert
  checkTokenStatus();
  
  // Event listeners
  searchForm.addEventListener('submit', performSearch);
  selectAllBtn.addEventListener('click', toggleSelectAll);
  downloadBtn.addEventListener('click', downloadSelectedAds);
  tokenForm.addEventListener('submit', saveToken);
  advancedSearchToggle.addEventListener('change', toggleAdvancedOptions);
  
  // Toggle advanced options visibility
  function toggleAdvancedOptions() {
    advancedOptions.style.display = advancedSearchToggle.checked ? 'block' : 'none';
  }
  
  // Function to check if token is needed
  function checkTokenStatus() {
    // Basic check - will be confirmed when first search is attempted
    if (localStorage.getItem('hasValidToken') !== 'true') {
      tokenAlert.style.display = 'block';
    }
  }
  
  // Save and verify token
  async function saveToken(e) {
    e.preventDefault();
    
    const tokenInput = document.getElementById('facebookToken');
    const token = tokenInput.value.trim();
    
    if (!token) {
      showTokenResponse('Por favor, insira um token válido.', 'danger');
      return;
    }
    
    try {
      // Disable the submit button and show loading state
      const saveButton = document.getElementById('saveTokenBtn');
      const originalButtonText = saveButton.innerHTML;
      saveButton.disabled = true;
      saveButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verificando...';
      
      // Submit token to server
      const response = await fetch('/api/set-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });
      
      const result = await response.json();
      
      // Reset button state
      saveButton.disabled = false;
      saveButton.innerHTML = originalButtonText;
      
      if (result.success) {
        showTokenResponse(result.message, 'success');
        localStorage.setItem('hasValidToken', 'true');
        tokenAlert.style.display = 'none';
        
        // Close the modal after a brief delay to show success message
        setTimeout(() => {
          tokenModal.hide();
        }, 2000);
      } else {
        showTokenResponse(result.message || 'Token inválido ou expirado.', 'danger');
        localStorage.removeItem('hasValidToken');
      }
    } catch (error) {
      console.error('Error saving token:', error);
      showTokenResponse('Erro ao processar o token. Tente novamente.', 'danger');
    }
  }
  
  // Display token response message
  function showTokenResponse(message, type) {
    tokenResponseMessage.textContent = message;
    tokenResponseMessage.className = \`alert alert-\${type}\`;
    tokenResponseMessage.style.display = 'block';
  }
  
  // Search for ads via the API
  async function performSearch(e) {
    e.preventDefault();
    
    const query = searchQuery.value.trim();
    const type = searchType.value;
    const country = countryFilter.value;
    const limit = resultLimit.value;
    
    // Get advanced options if enabled
    const useAdvancedOptions = advancedSearchToggle.checked;
    const activeStatus = useAdvancedOptions ? adActiveStatus.value : 'ALL';
    const adTypeValue = useAdvancedOptions ? adType.value : 'ALL';
    
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
      const searchParams = new URLSearchParams({
        query: query,
        searchType: type,
        country: country,
        limit: limit,
        adActiveStatus: activeStatus,
        adType: adTypeValue
      });
      
      const response = await fetch(\`/api/search?\${searchParams.toString()}\`);
      const data = await response.json();
      
      // Hide loading
      loadingResults.style.display = 'none';
      
      // Check if we need a token
      if (data.needToken) {
        tokenAlert.style.display = 'block';
        resultsContainer.innerHTML = \`
          <div class="col-12">
            <div class="alert alert-warning">
              <i class="bi bi-exclamation-triangle-fill"></i> \${data.message || 'Token do Facebook não configurado.'}
              <button class="btn btn-sm btn-warning ms-2" data-bs-toggle="modal" data-bs-target="#tokenModal">
                Configurar Token
              </button>
            </div>
          </div>
        \`;
        return;
      }
      
      if (data.data && data.data.length > 0) {
        searchResults = data.data;
        displayResults(searchResults);
        
        // Update token status if search was successful
        localStorage.setItem('hasValidToken', 'true');
        tokenAlert.style.display = 'none';
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
    
    // Debug: Visualizar estrutura completa do anúncio para verificar caminhos de imagem
    console.log("Anúncio " + index + ":", JSON.stringify(ad, null, 2));
    
    // Função para extrair URL da imagem de um objeto de imagem
    function extractImageUrl(imgObj) {
      if (!imgObj) return null;
      
      // Tentar diferentes formatos de URL de imagem que o Facebook pode retornar
      if (imgObj.url) return imgObj.url;
      if (imgObj.original_image_url) return imgObj.original_image_url;
      if (imgObj.permalink_url) return imgObj.permalink_url;
      if (imgObj.preview_image_url) return imgObj.preview_image_url;
      
      // Verificar se é apenas uma string
      if (typeof imgObj === 'string') return imgObj;
      
      // Verificar se tem um formato diferente
      if (typeof imgObj === 'object') {
        if (imgObj.media && imgObj.media.image && imgObj.media.image.src) {
          return imgObj.media.image.src;
        }
      }
      
      return null;
    }
    
    // Extrair imagens do anúncio
    if (ad.ad_creative_images) {
      let images = ad.ad_creative_images;
      
      // Às vezes o Facebook retorna como objeto em vez de array
      if (!Array.isArray(images) && images.data) {
        images = images.data;
      }
      
      if (Array.isArray(images) && images.length > 0) {
        const extracted = extractImageUrl(images[0]);
        if (extracted) {
          imageUrl = extracted;
          console.log("Imagem do anúncio " + index + ":", imageUrl);
        }
      }
    }
    
    // Verificar se tem vídeos
    if (ad.ad_creative_videos) {
      let videos = ad.ad_creative_videos;
      
      // Às vezes o Facebook retorna como objeto em vez de array
      if (!Array.isArray(videos) && videos.data) {
        videos = videos.data;
      }
      
      if (Array.isArray(videos) && videos.length > 0) {
        hasVideo = true;
        
        // Tentar obter a thumbnail do vídeo para exibir
        const firstVideo = videos[0];
        const videoThumb = extractImageUrl(firstVideo);
        
        if (videoThumb) {
          imageUrl = videoThumb;
          console.log("Thumbnail do vídeo " + index + ":", imageUrl);
        }
      }
    }
    
    // Identificar o país do anúncio (se disponível)
    let countryInfo = '';
    if (ad.targeting && ad.targeting.geo_locations && ad.targeting.geo_locations.countries) {
      const countries = ad.targeting.geo_locations.countries;
      if (countries.includes('BR')) {
        countryInfo = '<span class="badge bg-success">Brasil</span> ';
      } else {
        countryInfo = '<span class="badge bg-secondary">' + countries.join(', ') + '</span> ';
      }
    }
    
    // Formatar título, usando o primeiro título disponível ou o início do corpo do anúncio
    let title = 'Sem Título';
    if (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) {
      title = ad.ad_creative_link_titles[0];
    } else if (ad.ad_creative_bodies && ad.ad_creative_bodies[0]) {
      title = ad.ad_creative_bodies[0].substring(0, 50) + '...';
    }
    
    col.innerHTML = \`
      <div class="ad-card">
        <div class="ad-image-container">
          <div class="ad-checkbox-container">
            <input type="checkbox" class="ad-checkbox" data-index="\${index}">
          </div>
          \${hasVideo ? '<div class="ad-video-indicator"><i class="bi bi-play-fill"></i> Vídeo</div>' : ''}
          <img src="\${imageUrl}" class="ad-image" alt="Ad creative" onerror="this.onerror=null;this.src='https://via.placeholder.com/300x200?text=Imagem+Indisponível';">
        </div>
        <div class="card-body">
          <div class="ad-advertiser">\${ad.page_name || 'Anunciante Desconhecido'} \${countryInfo}</div>
          <div class="ad-date">Data de Início: \${startDate}</div>
          <h5 class="card-title">\${title}</h5>
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
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
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
          <button class="btn btn-outline-light btn-sm me-2" onclick="window.location.href='/#' + new Date().getTime()" data-bs-toggle="modal" data-bs-target="#tokenModal">
            <i class="bi bi-key-fill"></i> Configurar Token
          </button>
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

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  
  // Abrir o navegador automaticamente apenas em ambiente de desenvolvimento (não no Render)
  if (process.env.NODE_ENV !== 'production') {
    open(`http://localhost:${port}`);
  }
}); 