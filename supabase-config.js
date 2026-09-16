// Supabase Configuration & Leaderboard Helper
(function () {
  const SUPABASE_URL = 'https://dllelezatmqikgzizkss.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGVsZXphdG1xaWtneml6a3NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTkxMDQsImV4cCI6MjEwNTA5NTEwNH0.7sTMk5fujJEBz0QpLfKC2D7ynkem6F8ToZ_Yv4Wkz4U';

  window.SUPABASE_CONFIG = {
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY
  };

  let client = null;
  function initClient() {
    if (!client && typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } catch (e) {
        console.warn('Gagal inisialisasi Supabase client:', e);
      }
    }
    return client;
  }

  window.isSupabaseReady = function () {
    return !!initClient();
  };

  // Submit high score to Supabase leaderboard
  window.submitGlobalScore = async function (playerName, score, difficulty) {
    const c = initClient();
    if (!c) {
      throw new Error('Supabase client belum siap atau library supabase belum dimuat.');
    }

    const cleanName = (playerName || '').trim();
    if (!cleanName) {
      throw new Error('Nama pemain tidak boleh kosong.');
    }
    if (cleanName.length > 30) {
      throw new Error('Nama pemain maksimal 30 karakter.');
    }
    if (typeof score !== 'number' || score < 0) {
      throw new Error('Skor tidak valid.');
    }

    const { data, error } = await c
      .from('leaderboard')
      .insert([
        {
          player_name: cleanName,
          score: Math.floor(score),
          difficulty: difficulty || 'normal'
        }
      ])
      .select();

    if (error) {
      console.error('Error insert leaderboard:', error);
      throw error;
    }

    return data;
  };

  // Fetch top leaderboard entries (filtered by difficulty if specified)
  window.fetchGlobalLeaderboard = async function (difficultyFilter = 'all', limit = 15) {
    const c = initClient();
    if (!c) {
      throw new Error('Supabase client belum siap atau library supabase belum dimuat.');
    }

    let query = c
      .from('leaderboard')
      .select('id, player_name, score, difficulty, created_at')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(limit);

    if (difficultyFilter && difficultyFilter !== 'all') {
      query = query.eq('difficulty', difficultyFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetch leaderboard:', error);
      throw error;
    }

    return data || [];
  };
})();
