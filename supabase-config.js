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

  // =========================================================================
  // USER AUTH, COINS, & SKIN SHOP HELPERS
  // =========================================================================

  // Client-side SHA-256 password hashing with salt
  async function hashPassword(plainPassword) {
    if (!plainPassword) return '';
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const enc = new TextEncoder().encode(plainPassword + '_snake_salt_2026');
        const hashBuf = await crypto.subtle.digest('SHA-256', enc);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn('Crypto subtle gagal, gunakan fallback:', e);
      }
    }
    // Fallback simple hash for older environments
    let hash = 0;
    const str = plainPassword + '_snake_salt_2026';
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'fallback_' + Math.abs(hash).toString(16);
  }

  // Local fallback storage manager
  function getLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem('snake_local_users_db') || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveLocalUsers(db) {
    try {
      localStorage.setItem('snake_local_users_db', JSON.stringify(db));
    } catch (e) {
      console.warn('Gagal simpan lokal users:', e);
    }
  }

  // Current session management
  window.getCurrentSnakeUser = function () {
    try {
      const u = localStorage.getItem('snake_active_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  };

  window.setCurrentSnakeUser = function (user) {
    if (!user) {
      localStorage.removeItem('snake_active_user');
    } else {
      localStorage.setItem('snake_active_user', JSON.stringify(user));
      if (user.username) {
        localStorage.setItem('snake_player_name', user.username);
      }
    }
  };

  window.logoutSnakeUser = function () {
    localStorage.removeItem('snake_active_user');
    localStorage.removeItem('snake_user_pwd_hash');
  };

  // Register User
  window.registerSnakeUser = async function (username, password) {
    const cleanUser = (username || '').trim();
    if (cleanUser.length < 3 || cleanUser.length > 25) {
      return { success: false, message: 'Username harus terdiri dari 3 hingga 25 karakter.' };
    }
    if (!password || password.length < 4) {
      return { success: false, message: 'Password minimal 4 karakter.' };
    }

    const pwdHash = await hashPassword(password);
    const c = initClient();

    // 1. Coba lewat Supabase RPC
    if (c) {
      try {
        const { data, error } = await c.rpc('register_snake_user', {
          p_username: cleanUser,
          p_password_hash: pwdHash
        });

        if (!error && data) {
          if (data.success && data.user) {
            window.setCurrentSnakeUser(data.user);
            localStorage.setItem('snake_user_pwd_hash', pwdHash);
            // Simpan juga ke local db sebagai backup
            const localDb = getLocalUsers();
            localDb[cleanUser.toLowerCase()] = { ...data.user, password_hash: pwdHash };
            saveLocalUsers(localDb);
          }
          return data;
        }
        if (error) {
          console.warn('Supabase register RPC error, beralih ke local fallback:', error);
        }
      } catch (err) {
        console.warn('Error saat panggil register_snake_user:', err);
      }
    }

    // 2. Fallback: LocalStorage
    const localDb = getLocalUsers();
    const key = cleanUser.toLowerCase();
    if (localDb[key]) {
      return { success: false, message: 'Username sudah digunakan secara lokal. Silakan masuk.' };
    }

    const newUser = {
      username: cleanUser,
      password_hash: pwdHash,
      coins: 5,
      unlocked_skins: ['classic'],
      active_skin: 'classic'
    };
    localDb[key] = newUser;
    saveLocalUsers(localDb);
    window.setCurrentSnakeUser(newUser);
    localStorage.setItem('snake_user_pwd_hash', pwdHash);

    return {
      success: true,
      message: 'Pendaftaran berhasil (mode offline/lokal)! Kamu mendapatkan bonus 5 koin 🎉',
      user: newUser
    };
  };

  // Login User
  window.loginSnakeUser = async function (username, password) {
    const cleanUser = (username || '').trim();
    if (!cleanUser) {
      return { success: false, message: 'Silakan masukkan username.' };
    }
    if (!password) {
      return { success: false, message: 'Silakan masukkan password.' };
    }

    const pwdHash = await hashPassword(password);
    const c = initClient();

    // 1. Coba lewat Supabase RPC
    if (c) {
      try {
        const { data, error } = await c.rpc('login_snake_user', {
          p_username: cleanUser,
          p_password_hash: pwdHash
        });

        if (!error && data) {
          if (data.success && data.user) {
            window.setCurrentSnakeUser(data.user);
            localStorage.setItem('snake_user_pwd_hash', pwdHash);
            const localDb = getLocalUsers();
            localDb[cleanUser.toLowerCase()] = { ...data.user, password_hash: pwdHash };
            saveLocalUsers(localDb);
          }
          return data;
        }
        if (error) {
          console.warn('Supabase login RPC error, beralih ke local fallback:', error);
        }
      } catch (err) {
        console.warn('Error saat login_snake_user:', err);
      }
    }

    // 2. Fallback: LocalStorage
    const localDb = getLocalUsers();
    const key = cleanUser.toLowerCase();
    const existing = localDb[key];
    if (!existing) {
      return { success: false, message: 'Username tidak ditemukan.' };
    }
    if (existing.password_hash !== pwdHash) {
      return { success: false, message: 'Password salah.' };
    }

    window.setCurrentSnakeUser(existing);
    localStorage.setItem('snake_user_pwd_hash', pwdHash);

    return {
      success: true,
      message: 'Berhasil masuk kembali, ' + existing.username + '!',
      user: existing
    };
  };

  // Add Coins to User Account
  window.addSnakeCoins = async function (username, coinsToAdd) {
    if (!username || !coinsToAdd || coinsToAdd <= 0) return null;

    const c = initClient();
    let updatedCoins = null;

    if (c) {
      try {
        const { data, error } = await c.rpc('add_snake_coins', {
          p_username: username,
          p_coins: coinsToAdd
        });
        if (!error && data && data.success) {
          updatedCoins = data.coins;
        }
      } catch (err) {
        console.warn('Gagal add_snake_coins ke Supabase:', err);
      }
    }

    // Update session user di localStorage
    const current = window.getCurrentSnakeUser();
    if (current && current.username.toLowerCase() === username.toLowerCase()) {
      current.coins = (updatedCoins !== null) ? updatedCoins : (current.coins || 0) + coinsToAdd;
      window.setCurrentSnakeUser(current);

      const localDb = getLocalUsers();
      const key = username.toLowerCase();
      if (localDb[key]) {
        localDb[key].coins = current.coins;
        saveLocalUsers(localDb);
      }
      return current.coins;
    }

    return updatedCoins;
  };

  // Buy Skin
  window.buySnakeSkin = async function (skinId, cost) {
    const current = window.getCurrentSnakeUser();
    if (!current) {
      return { success: false, message: 'Kamu harus masuk terlebih dahulu untuk membeli kostum di akunmu.' };
    }

    const pwdHash = localStorage.getItem('snake_user_pwd_hash');
    const c = initClient();

    if (c && pwdHash) {
      try {
        const { data, error } = await c.rpc('buy_snake_skin', {
          p_username: current.username,
          p_password_hash: pwdHash,
          p_skin_id: skinId,
          p_cost: cost
        });

        if (!error && data) {
          if (data.success) {
            current.coins = data.coins;
            current.active_skin = data.active_skin;
            current.unlocked_skins = data.unlocked_skins;
            window.setCurrentSnakeUser(current);

            const localDb = getLocalUsers();
            const key = current.username.toLowerCase();
            if (localDb[key]) {
              localDb[key].coins = data.coins;
              localDb[key].active_skin = data.active_skin;
              localDb[key].unlocked_skins = data.unlocked_skins;
              saveLocalUsers(localDb);
            }
          }
          return data;
        }
      } catch (err) {
        console.warn('Gagal buy_snake_skin via Supabase:', err);
      }
    }

    // Local fallback
    if (current.coins < cost) {
      return {
        success: false,
        message: 'Koin tidak cukup! Butuh ' + cost + ' koin, kamu punya ' + current.coins + ' koin.'
      };
    }

    current.coins -= cost;
    if (!current.unlocked_skins.includes(skinId)) {
      current.unlocked_skins.push(skinId);
    }
    current.active_skin = skinId;
    window.setCurrentSnakeUser(current);

    const localDb = getLocalUsers();
    const key = current.username.toLowerCase();
    if (localDb[key]) {
      localDb[key] = { ...localDb[key], ...current };
      saveLocalUsers(localDb);
    }

    return {
      success: true,
      message: 'Selamat! Kostum berhasil dibeli dan dipasang! 🎉',
      coins: current.coins,
      active_skin: current.active_skin,
      unlocked_skins: current.unlocked_skins
    };
  };

  // Equip Skin
  window.equipSnakeSkin = async function (skinId) {
    const current = window.getCurrentSnakeUser();
    if (!current) {
      // Guest equip
      localStorage.setItem('snake_guest_active_skin', skinId);
      return { success: true, message: 'Kostum berhasil dipasang!', active_skin: skinId };
    }

    const pwdHash = localStorage.getItem('snake_user_pwd_hash');
    const c = initClient();

    if (c && pwdHash) {
      try {
        const { data, error } = await c.rpc('equip_snake_skin', {
          p_username: current.username,
          p_password_hash: pwdHash,
          p_skin_id: skinId
        });

        if (!error && data && data.success) {
          current.active_skin = skinId;
          window.setCurrentSnakeUser(current);

          const localDb = getLocalUsers();
          const key = current.username.toLowerCase();
          if (localDb[key]) {
            localDb[key].active_skin = skinId;
            saveLocalUsers(localDb);
          }
          return data;
        }
      } catch (err) {
        console.warn('Gagal equip_snake_skin via Supabase:', err);
      }
    }

    // Local fallback
    if (!current.unlocked_skins.includes(skinId)) {
      return { success: false, message: 'Kamu belum memiliki kostum ini.' };
    }

    current.active_skin = skinId;
    window.setCurrentSnakeUser(current);

    const localDb = getLocalUsers();
    const key = current.username.toLowerCase();
    if (localDb[key]) {
      localDb[key].active_skin = skinId;
      saveLocalUsers(localDb);
    }

    return { success: true, message: 'Kostum berhasil dipasang!', active_skin: skinId };
  };

  // Fetch updated profile
  window.fetchSnakeUserProfile = async function (username) {
    const cleanUser = (username || '').trim();
    if (!cleanUser) return null;
    const c = initClient();

    if (c) {
      try {
        const { data, error } = await c.rpc('get_snake_user_profile', {
          p_username: cleanUser
        });
        if (!error && data && data.success) {
          return data.user;
        }
      } catch (e) {
        console.warn('Error fetch profile:', e);
      }
    }

    const localDb = getLocalUsers();
    return localDb[cleanUser.toLowerCase()] || null;
  };
})();

