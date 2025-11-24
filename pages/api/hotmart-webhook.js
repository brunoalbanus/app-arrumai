import { createClient } from '@supabase/supabase-js';
return Buffer.concat(chunks).toString('utf8');
}


const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HOTMART_TOKEN = process.env.HOTMART_WEBHOOK_TOKEN; // o token que você configura no Hotmart


const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });


export default async function handler(req, res) {
if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');


// 1) validar token que vem no header (nome do header pode variar)
const incomingToken = req.headers['x-hotmart-hottok'] || req.headers['x-hotmart-token'] || req.headers['x-hotmart-token-secret'];
if (!incomingToken || incomingToken !== HOTMART_TOKEN) {
console.warn('Token inválido');
return res.status(401).end('Invalid token');
}


// 2) pegar body bruto e transformar em JSON
const text = await buffer(req);
let payload = {};
try { payload = JSON.parse(text); } catch (e) { console.warn('JSON parse failed', e); }


// 3) extrair informações (o formato pode variar, adapte conforme o que o Hotmart enviar)
const event = payload.event || payload.type || payload.action || null;
const transaction = payload.data || payload.transaction || payload.resource || {};
const transactionId = transaction.id || transaction.transaction_id || payload.id || null;
const buyerEmail = transaction.buyer_email || transaction.buyer?.email || transaction.email || null;
const productId = transaction.product_id || transaction.product?.id || null;


// 4) salvar o evento bruto no Supabase (para auditoria)
try {
await supabase.from('hotmart_events').insert([{ transaction_id: transactionId, event_type: event, payload }]);
} catch (err) {
console.error('Erro ao salvar evento', err);
}


// 5) lógica simples: se aprovado -> marcar premium; se reembolso/cancelado -> remover
const isApproved = (event && event.toLowerCase().includes('approved')) || (transaction.status && transaction.status.toLowerCase() === 'approved');
const isRefunded = (event && event.toLowerCase().includes('refunded')) || (transaction.status && transaction.status.toLowerCase() === 'refunded') || (event && event.toLowerCase().includes('cancel'));


try {
if (isApproved && buyerEmail) {
// marca user como premium por exemplo 1 ano (ou use o valor do payload)
const oneYearFromNow = new Date();
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);


await supabase.from('users').upsert({ email: buyerEmail, is_premium: true, premium_until: oneYearFromNow.toISOString() }, { onConflict: ['email'] });
}


if (isRefunded && buyerEmail) {
await supabase.from('users').update({ is_premium: false, premium_until: null }).eq('email', buyerEmail);
}
} catch (err) {
console.error('Erro ao atualizar user', err);
return res.status(500).end('DB Error');
}


// responder 200 para o Hotmart
return res.status(200).end('OK');
}
