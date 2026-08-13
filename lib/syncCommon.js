'use strict';
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios (nunca hardcodear).');
  }
  return createClient(url, serviceRoleKey);
}

async function getCategoryIdMap(supabase) {
  const { data, error } = await supabase.from('categories').select('id, name');
  if (error) throw error;
  return new Map(data.map((c) => [c.name, c.id]));
}

async function logSyncStart(supabase, supplierId) {
  const { data, error } = await supabase
    .from('sync_log')
    .insert({ supplier_id: supplierId, status: 'partial', started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function logSyncFinish(supabase, logId, { status, itemsSynced, message }) {
  const { error } = await supabase
    .from('sync_log')
    .update({
      status,
      items_synced: itemsSynced,
      message: message ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', logId);
  if (error) throw error;
}

module.exports = { getSupabaseClient, getCategoryIdMap, logSyncStart, logSyncFinish };
