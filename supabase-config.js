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

  // Submit high score to Supabase leaderboard (retains only highest score per player and difficulty)
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

    const finalDifficulty = difficulty || 'normal';
    const finalScore = Math.floor(score);

    // 1. Coba panggil fungsi RPC database record_high_score
    try {
      const { data: rpcData, error: rpcError } = await c.rpc('record_high_score', {
        p_player_name: cleanName,
        p_score: finalScore,
        p_difficulty: finalDifficulty
      });

      if (!rpcError && rpcData) {
        return rpcData;
      }
      if (rpcError) {
        console.warn('RPC record_high_score gagal, beralih ke metode fallback:', rpcError);
      }
    } catch (rpcEx) {
      console.warn('Error saat panggil RPC record_high_score:', rpcEx);
    }

    // 2. Fallback: query dan update/insert langsung ke tabel leaderboard
    const { data: existing, error: fetchErr } = await c
      .from('leaderboard')
      .select('id, score')
      .eq('player_name', cleanName)
      .eq('difficulty', finalDifficulty)
      .maybeSingle();

    if (fetchErr) {
      console.error('Error cek data leaderboard sebelumnya:', fetchErr);
      throw fetchErr;
    }

    if (existing) {
      if (finalScore > existing.score) {
        const { data: updateData, error: updateErr } = await c
          .from('leaderboard')
          .update({
            score: finalScore,
            created_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select();

        if (updateErr) {
          console.error('Error update rekor leaderboard:', updateErr);
          throw updateErr;
        }

        return {
          action: 'updated',
          is_new_high: true,
          previous_score: existing.score,
          current_score: finalScore,
          player_name: cleanName,
          difficulty: finalDifficulty,
          data: updateData
        };
      } else {
        // Skor saat ini tidak melampaui rekor di database, simpan rekor lama
        return {
          action: 'ignored',
          is_new_high: false,
          previous_score: existing.score,
          current_score: existing.score,
          submitted_score: finalScore,
          player_name: cleanName,
          difficulty: finalDifficulty
        };
      }
    }

    // Jika belum ada catatan sebelumnya, masukkan catatan baru
    const { data: insertData, error: insertErr } = await c
      .from('leaderboard')
      .insert([
        {
          player_name: cleanName,
          score: finalScore,
          difficulty: finalDifficulty
        }
      ])
      .select();

    if (insertErr) {
      console.error('Error insert leaderboard:', insertErr);
      throw insertErr;
    }

    return {
      action: 'inserted',
      is_new_high: true,
      current_score: finalScore,
      player_name: cleanName,
      difficulty: finalDifficulty,
      data: insertData
    };
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
