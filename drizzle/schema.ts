import {
  boolean,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Google OAuth tokens are persisted here so background jobs can reuse them
 * across server restarts (the legacy in-memory store was lost on reboot).
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  googleAccessToken: text("googleAccessToken"),
  googleRefreshToken: text("googleRefreshToken"),
  googleTokenExpiresAt: timestamp("googleTokenExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Maps a Drive folder (image bank category) to a 3-letter SKU code and to
 * the Tray category taxonomy. Seeded from the existing Drive folder names
 * (e.g. "#FG Formas Geométricas" -> code "FOR", Tray "Quadros Decorativos > Geométricos").
 */
export const categoryCodes = mysqlTable(
  "category_codes",
  {
    id: int("id").autoincrement().primaryKey(),
    folderName: varchar("folderName", { length: 255 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    code3: varchar("code3", { length: 3 }).notNull(),
    trayCategoriaPrincipal: varchar("trayCategoriaPrincipal", { length: 255 }).notNull(),
    traySubcategoria: varchar("traySubcategoria", { length: 255 }),
    traySubsubcategoria: varchar("traySubsubcategoria", { length: 255 }),
    driveFolderId: varchar("driveFolderId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    folderNameIdx: uniqueIndex("category_codes_folderName_idx").on(table.folderName),
    code3Idx: uniqueIndex("category_codes_code3_idx").on(table.code3),
  }),
);

export type CategoryCode = typeof categoryCodes.$inferSelect;
export type InsertCategoryCode = typeof categoryCodes.$inferInsert;

/**
 * Pipeline status for a single product flowing through the catalog automation:
 * suggested -> approved -> generating -> generated -> exported
 * (rejected/error are terminal off-ramps)
 */
export const productStatusEnum = [
  "suggested",
  "approved",
  "generating",
  "generated",
  "exported",
  "rejected",
  "error",
] as const;

/**
 * Catalog product. Columns mirror the Tray import spreadsheet
 * (Modelo_Produtos_Preenchido.xlsx) plus pipeline tracking fields.
 * One row per product the system surfaces from the Drive image bank.
 */
export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    categoryCodeId: int("categoryCodeId"),

    // Identidade comercial
    sku: varchar("sku", { length: 128 }).notNull(),
    nome: varchar("nome", { length: 255 }).notNull(),
    descricaoHtml: text("descricaoHtml"),
    slugSeo: varchar("slugSeo", { length: 255 }),

    // Defaults da loja Qtok (fixos por enquanto, viram variações depois)
    precoVenda: decimal("precoVenda", { precision: 10, scale: 2 }).default("199.90").notNull(),
    precoCusto: decimal("precoCusto", { precision: 10, scale: 2 }).default("89.90").notNull(),
    estoque: int("estoque").default(99).notNull(),
    ncm: varchar("ncm", { length: 20 }).default("4911.99.90").notNull(),
    prazoDisponibilidade: int("prazoDisponibilidade").default(7).notNull(),
    pesoGramas: int("pesoGramas").default(1200).notNull(),
    larguraCm: decimal("larguraCm", { precision: 6, scale: 2 }).default("62.00").notNull(),
    alturaCm: decimal("alturaCm", { precision: 6, scale: 2 }).default("32.00").notNull(),
    comprimentoCm: decimal("comprimentoCm", { precision: 6, scale: 2 }).default("3.00").notNull(),
    marca: varchar("marca", { length: 128 }).default("Qtok Quadros").notNull(),
    modelo: varchar("modelo", { length: 128 }),
    ean: varchar("ean", { length: 32 }),
    tempoGarantia: varchar("tempoGarantia", { length: 64 }).default("30 dias").notNull(),
    exibirAtivo: boolean("exibirAtivo").default(true).notNull(),
    exibirNaLoja: boolean("exibirNaLoja").default(true).notNull(),

    // Origem (banco de imagens no Drive)
    sourceDriveFileId: varchar("sourceDriveFileId", { length: 128 }),
    sourceDriveFileUrl: text("sourceDriveFileUrl"),

    // Pasta do produto criada no Drive (Etapa 3)
    productDriveFolderId: varchar("productDriveFolderId", { length: 128 }),
    productDriveFolderUrl: text("productDriveFolderUrl"),

    // URLs públicas das imagens geradas (vão direto para a planilha Tray)
    imageUrl1: text("imageUrl1"),
    imageUrl2: text("imageUrl2"),
    imageUrl3: text("imageUrl3"),
    imageUrl4: text("imageUrl4"),
    imageUrl5: text("imageUrl5"),

    // Mockup gerado para cada cor de moldura (Etapa 4 do pipeline) — usados
    // como "imagem principal da variação" na planilha de variações Tray,
    // pra que cada opção de moldura (Amadeirado claro/escuro, Branca, Preta)
    // mostre a foto do produto montado naquela cor específica.
    mockupUrlLightWood: text("mockupUrlLightWood"),
    mockupUrlDarkWood: text("mockupUrlDarkWood"),
    mockupUrlWhite: text("mockupUrlWhite"),
    mockupUrlBlack: text("mockupUrlBlack"),

    // Metadados da curadoria por IA (Etapa 1)
    aiPotencialVenda: int("aiPotencialVenda"),
    aiPalavrasChave: text("aiPalavrasChave"),
    aiPublicoAlvo: text("aiPublicoAlvo"),

    // Pipeline
    status: mysqlEnum("status", productStatusEnum).default("suggested").notNull(),
    errorMessage: text("errorMessage"),

    // Fila de geração de imagens (Passo 2)
    genQueuedAt: timestamp("genQueuedAt"),
    genStartedAt: timestamp("genStartedAt"),
    genCompletedAt: timestamp("genCompletedAt"),
    genStep: int("genStep"), // 1..3 — última etapa concluída pelo worker
    genAttempts: int("genAttempts").default(0).notNull(),
    genError: text("genError"),
    // Estilo escolhido manualmente na fila (opcional). Nulo = usa o padrão
    // de marca goquadros_signature.
    genStyleOverride: varchar("genStyleOverride", { length: 32 }),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    approvedAt: timestamp("approvedAt"),
    generatedAt: timestamp("generatedAt"),
    exportedAt: timestamp("exportedAt"),
  },
  (table) => ({
    skuIdx: uniqueIndex("products_sku_idx").on(table.sku),
  }),
);

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
