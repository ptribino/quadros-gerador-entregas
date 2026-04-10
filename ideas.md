# Brainstorm de Design — Gerador de Prompts para Quadros Decorativos

## Contexto
Um site interativo que transforma especificações técnicas de prompts para geração de imagens e vídeos de e-commerce de quadros decorativos. O usuário seleciona tipo de entrega, moldura, ambiente e o site gera o prompt pronto para copiar.

---

## Resposta 1: Minimalismo Funcional com Tipografia Contrastante
**Probability: 0.07**

**Design Movement:** Swiss Design meets Contemporary Minimalism

**Core Principles:**
- Hierarquia tipográfica extrema: títulos em sans-serif geométrico (Montserrat Bold), corpo em Geist Mono para dados técnicos
- Espaço negativo como protagonista: margens generosas, grid de 8px, sem decoração supérflua
- Interação através de microinterações sutis: hover states com mudança de cor, transições de 200ms
- Foco total no conteúdo: o prompt gerado é a estrela, tudo mais é suporte

**Color Philosophy:**
- Paleta: Branco puro (background), Cinza charcoal (texto), Azul marítimo profundo (CTA), Bege quente (accent)
- Intenção: Transmitir profissionalismo e confiabilidade para profissionais de e-commerce
- Uso estratégico de cor: apenas CTAs e elementos interativos em azul, resto neutro

**Layout Paradigm:**
- Estrutura assimétrica: painel de seleção à esquerda (30%), preview do prompt à direita (70%)
- Sticky sidebar com controles, conteúdo scrollável na direita
- Sem centragem excessiva, alinhamento à esquerda para sensação de fluxo

**Signature Elements:**
- Linhas divisórias sutis (1px, cinza claro) separando seções
- Ícones minimalistas (Lucide) em preto, nunca coloridos
- Cards com border-left colorido (2px) em vez de sombra

**Interaction Philosophy:**
- Seleções imediatas: sem botão "gerar", o prompt atualiza em tempo real
- Feedback visual claro: checkbox animado, radio button com transição suave
- Copy button com toast de confirmação

**Animation:**
- Transições de cor: 150ms ease-out
- Entrada de elementos: fade-in de 300ms
- Hover: mudança de cor + cursor pointer, sem escala

**Typography System:**
- Display: Montserrat Bold 32px, line-height 1.2
- Heading: Montserrat SemiBold 18px
- Body: Geist Regular 14px
- Mono (prompts): Geist Mono 13px, background cinza claro

---

## Resposta 2: Neomorfismo Caloroso com Gradientes Sutis
**Probability: 0.08**

**Design Movement:** Soft UI meets Organic Minimalism

**Core Principles:**
- Profundidade através de sombras suaves (blur 12px, offset 4px), sem bordas duras
- Paleta quente e acessível: bege, terracota, verde sálvia
- Formas levemente arredondadas (radius 12px) para sensação acolhedora
- Gradientes verticais sutis em backgrounds para movimento visual

**Color Philosophy:**
- Paleta: Fundo bege quente (oklch 0.95 0.01 60), Cards em branco leitoso, Terracota (oklch 0.65 0.15 40) para CTAs, Verde sálvia (oklch 0.65 0.08 160) para secundário
- Intenção: Criar ambiente acolhedor e inspirador, não corporativo
- Uso: Gradientes suaves de bege para branco em backgrounds, cores sólidas em componentes

**Layout Paradigm:**
- Layout em cards flutuantes: cada seção (tipo entrega, moldura, ambiente) em card separado com sombra
- Grid responsivo: 1 coluna mobile, 2 colunas tablet, 3 colunas desktop
- Cards com espaçamento generoso (gap 24px)

**Signature Elements:**
- Ícones grandes e coloridos (48px) representando cada tipo de entrega
- Badges arredondadas com gradiente para categorias
- Dividers curvos (SVG) entre seções

**Interaction Philosophy:**
- Seleção com card expansion: ao clicar, card cresce e mostra mais detalhes
- Animação de entrada: cards aparecem com bounce suave
- Feedback tátil: sombra aumenta no hover, cor muda para terracota

**Animation:**
- Spring animation para seleções (stiffness 300, damping 30)
- Entrada de cards: stagger de 100ms entre cada
- Hover: sombra aumenta + cor muda, duração 200ms

**Typography System:**
- Display: Poppins Bold 36px, color terracota
- Heading: Poppins SemiBold 20px
- Body: Poppins Regular 15px
- Mono (prompts): IBM Plex Mono 13px, background verde sálvia claro

---

## Resposta 3: Design Técnico com Painel de Controle Profissional
**Probability: 0.06**

**Design Movement:** Pro Tools Aesthetic meets Dark Mode Sophistication

**Core Principles:**
- Inspirado em ferramentas profissionais (Adobe, Figma): painel esquerdo fixo com controles, canvas central
- Modo escuro por padrão: fundo cinza muito escuro (oklch 0.15 0.01 0), elementos em cinza claro
- Tipografia monoespacial para dados técnicos, sans-serif para labels
- Feedback visual através de cores vibrantes (verde para sucesso, laranja para atenção)

**Color Philosophy:**
- Paleta: Fundo escuro (oklch 0.15 0.01 0), Painel cinza (oklch 0.22 0.01 0), Verde neon (oklch 0.75 0.25 130) para CTAs, Laranja (oklch 0.65 0.20 50) para alertas
- Intenção: Transmitir controle técnico, profissionalismo, ambiente de trabalho sério
- Uso: Cores vibrantes apenas em elementos interativos, resto neutro

**Layout Paradigm:**
- Sidebar fixo esquerdo (280px) com controles, main content area com preview do prompt
- Tabs para diferentes tipos de entrega (Lifestyle, Mockup, Vídeo)
- Código do prompt em editor monoespacial com syntax highlighting

**Signature Elements:**
- Ícones com stroke (2px) em verde neon
- Separadores verticais em cinza médio
- Badges com fundo opaco (alpha 0.2) para status

**Interaction Philosophy:**
- Seleção com toggle/checkbox, sem cards
- Preview em tempo real com syntax highlighting
- Copy button com animação de confirmação (checkmark)

**Animation:**
- Transições rápidas: 100ms ease-in-out
- Entrada de elementos: slide-in da esquerda
- Hover: mudança de cor + brilho sutil

**Typography System:**
- Display: IBM Plex Sans Bold 28px, color verde neon
- Heading: IBM Plex Sans SemiBold 16px
- Body: IBM Plex Sans Regular 13px
- Mono (prompts): IBM Plex Mono 12px, com syntax highlighting

---

## Decisão Final

**Design Escolhido: Minimalismo Funcional com Tipografia Contrastante (Resposta 1)**

Este design foi selecionado porque:
1. **Clareza máxima**: A hierarquia tipográfica extrema (Montserrat Bold + Geist Mono) cria distinção visual clara entre controles e conteúdo técnico
2. **Profissionalismo**: Paleta neutra com azul marítimo transmite confiabilidade para profissionais de e-commerce
3. **Eficiência**: Layout assimétrico (sidebar + preview) permite seleção rápida e visualização simultânea do prompt
4. **Escalabilidade**: Estrutura simples facilita adicionar novos tipos de entrega ou molduras sem redesenho
5. **Acessibilidade**: Espaço negativo generoso e contraste tipográfico beneficiam leitura e usabilidade

**Estilo Visual Consolidado:**
- Tipografia: Montserrat Bold para títulos, Geist Mono para prompts técnicos
- Cores: Branco, Cinza charcoal, Azul marítimo, Bege quente
- Espaçamento: Grid 8px, margens 24px-32px
- Componentes: Cards com border-left colorido, sem sombras pesadas
- Interação: Atualizações em tempo real, feedback visual claro, animações de 150-300ms
