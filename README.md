# Facebook Ads Downloader

Uma aplicação para fazer download de anúncios da Biblioteca de Anúncios do Facebook usando a API oficial do Facebook.

## Funcionalidades

- Pesquisa por palavra-chave ou nome do anunciante
- Visualiza anúncios com imagens, vídeos, textos e links
- Permite selecionar anúncios específicos ou todos de uma vez
- Download em massa de imagens, vídeos e metadados
- Opção para escolher quais tipos de conteúdo baixar (tudo, apenas imagens, apenas vídeos, etc.)

## Requisitos

- Node.js 12 ou superior
- NPM ou Yarn

## Instalação

1. Clone o repositório:
```
git clone https://seu-repositorio/facebook-ads-downloader.git
cd facebook-ads-downloader
```

2. Instale as dependências:
```
npm install
```

3. O token de acesso já está configurado no arquivo `config.js`. Caso precise atualizar, edite este arquivo.

## Uso

1. Inicie a aplicação:
```
npm start
```

2. A aplicação será aberta automaticamente no seu navegador padrão (ou acesse http://localhost:3000).

3. Como usar:
   - Digite uma palavra-chave ou nome de anunciante na caixa de pesquisa
   - Selecione o tipo de pesquisa (por palavra-chave ou por anunciante)
   - Clique em "Pesquisar"
   - Selecione os anúncios que deseja baixar marcando as caixas de seleção
   - Escolha o tipo de conteúdo que deseja baixar (tudo, imagens, vídeos, texto)
   - Clique em "Baixar Selecionados"
   - Os arquivos serão baixados para a pasta "downloads" no diretório da aplicação

## Publicação no GitHub

1. Crie um novo repositório no GitHub
2. Inicialize o Git no diretório do projeto:
```
git init
git add .
git commit -m "Versão inicial"
```

3. Adicione o repositório remoto e faça o push:
```
git remote add origin https://github.com/seu-usuario/nome-do-repositorio.git
git branch -M main
git push -u origin main
```

## Deploy no Render

1. Crie uma conta no [Render](https://render.com/) se ainda não tiver uma
2. No dashboard do Render, clique em "New" e selecione "Web Service"
3. Conecte com seu repositório GitHub
4. Configure o serviço:
   - Nome: facebook-ads-downloader (ou outro de sua preferência)
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node index.js`
   - Plano: Free (ou outro de sua escolha)
5. Configure as variáveis de ambiente:
   - Clique em "Advanced" e adicione a variável `PORT` com valor `10000` (o Render geralmente usa esta porta)
   - Se preferir não ter o token no código, adicione a variável `FACEBOOK_ACCESS_TOKEN` com o valor do seu token
6. Clique em "Create Web Service"

Após o deploy, o Render fornecerá um URL para acessar a aplicação.

## Notas

- O token de acesso do Facebook tem validade limitada. Caso expire, você precisará atualizá-lo no arquivo `config.js` ou na variável de ambiente do Render.
- A API do Facebook pode ter limites de requisições. Se você encontrar erros relacionados a limites, aguarde alguns minutos e tente novamente.
- Os downloads são organizados em pastas específicas por lote, com timestamp, para facilitar a organização.
- No ambiente de produção (Render), os arquivos baixados serão armazenados temporariamente e podem ser perdidos quando o servidor reiniciar. Para uso prolongado, considere integrar com um serviço de armazenamento como AWS S3 ou Google Cloud Storage.

## Estrutura do Projeto

- `index.js` - Servidor backend e rotas API
- `public/index.html` - Interface de usuário
- `public/script.js` - Lógica do frontend
- `public/styles.css` - Estilos da aplicação
- `config.js` - Configurações (token de acesso, porta, etc.)
- `downloads/` - Pasta onde os anúncios baixados são armazenados

## Limitações Conhecidas

- Atualmente, a aplicação só busca anúncios do Brasil. Para mudar isso, modifique o parâmetro 'country' na URL da API no arquivo `index.js`.
- Alguns vídeos ou imagens podem não ser baixados se estiverem protegidos por restrições adicionais do Facebook.

## Licença

Este projeto é para uso pessoal e não comercial. 