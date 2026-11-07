import 'dotenv/config';

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.startsWith('COLOQUE_AQUI_')) {
  throw new Error('JWT_SECRET é obrigatório e deve ter pelo menos 32 caracteres aleatórios.');
}

if (['domo-estoque-secret-key-2026', 'domo-estoque-casaos-secret-2026'].includes(jwtSecret)) {
  throw new Error('JWT_SECRET usa uma chave previsível conhecida. Gere uma chave aleatória nova.');
}

