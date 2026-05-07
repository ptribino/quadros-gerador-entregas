export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Google Cloud / AI
  googleProjectId: process.env.GOOGLE_PROJECT_ID ?? "",
  googleApiKey: process.env.GOOGLE_API_KEY ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/oauth/google/callback",
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? "",
  // Pasta raiz do banco de imagens "Catálogo Imagens" (origem do pipeline Tray)
  driveBankFolderId: process.env.DRIVE_BANK_FOLDER_ID ?? "",
  // Pasta destino onde o pipeline cria as pastas [SKU] de cada produto
  driveDestinationFolderId: process.env.DRIVE_DESTINATION_FOLDER_ID ?? "",
  // ID do arquivo "tamanho real / cores das molduras" no Drive (público).
  // Quando setado, vira a 4ª imagem (imageUrl4) de TODOS os produtos no
  // export Tray, sem precisar fazer upload por produto.
  driveSizeReferenceFileId: process.env.DRIVE_SIZE_REFERENCE_FILE_ID ?? "",
};
