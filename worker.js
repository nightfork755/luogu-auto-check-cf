// Cloudflare Worker (ES Module style)
// 读取 secret: env.LUOGU_ACCOUNTS （你通过 wrangler secret put 上传的 JSON 字符串）
// 支持：
// - Cron 触发 (scheduled)
// - 手动触发：POST /run -> 返回 JSON 报告
// - 简单状态页：GET /
export async function scheduled(event, env, ctx) {
  // 使用 event.waitUntil 以确保 Worker 在异步任务完成前不会被回收
  event.waitUntil(handleCheckin(env));
}

export async function fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/run') {
    // 手动触发并返回执行结果
    const result = await handleCheckin(env);
    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  if (request.method === 'GET' && url.pathname === '/') {
    return new Response('Luogu auto-checkin worker. Use Cron to run or POST /run to trigger.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

async function handleCheckin(env) {
  // 读取 secret（JSON 字符串）
  const raw = env.LUOGU_ACCOUNTS;
  if (!raw) {
    console.error('LUOGU_ACCOUNTS secret not set');
    return { ok: false, error: 'LUOGU_ACCOUNTS secret not set' };
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    console.error('Failed to parse LUOGU_ACCOUNTS secret JSON', e);
    return { ok: false, error: 'Failed to parse LUOGU_ACCOUNTS secret JSON' };
  }

  const accounts = cfg.token || [];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.warn('No accounts found in LUOGU_ACCOUNTS.token');
    return { ok: true, results: [], warning: 'No accounts found in LUOGU_ACCOUNTS.token' };
  }

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const results = [];

  // 遍历每个账号执行签到
  for (const acct of accounts) {
    const uid = acct._uid;
    const clientId = acct.__client_id;

    if (!clientId || !uid) {
      console.error('Skipping invalid account entry', acct);
      results.push({ uid: uid || null, ok: false, error: 'invalid account entry' });
      continue;
    }

    const cookie = `__client_id=${clientId}; _uid=${uid};`;
    const headers = {
      Cookie: cookie,
      'User-Agent': UA,
      // 根据需要可添加 Referer 或其他头
    };

    try {
      const resp = await fetch('https://www.luogu.com.cn/index/ajax_punch', {
        method: 'GET',
        headers,
      });

      const text = await resp.text();

      if (resp.status !== 200) {
        console.error(`Check-in failed uid=${uid}, status=${resp.status}, body=${text}`);
        results.push({
          uid,
          ok: false,
          status: resp.status,
          body: text,
          error: 'http_error',
        });
        continue;
      }

      let res;
      try {
        res = JSON.parse(text);
      } catch (e) {
        console.error(`Non-JSON response uid=${uid}`, text);
        results.push({ uid, ok: false, body: text, error: 'invalid_json' });
        continue;
      }

      console.log(`Checking in: uid=${uid}`);
      if (res.code === 200) {
        console.log(`Checked in successfully! uid=${uid}`);
        results.push({ uid, ok: true, code: res.code, message: 'Checked in successfully' });
      } else if (res.code === 201) {
        console.log(`Already checked in today. uid=${uid}`);
        results.push({ uid, ok: true, code: res.code, message: 'Already checked in today' });
      } else {
        console.log(`Unexpected response uid=${uid}`, res);
        results.push({ uid, ok: false, code: res.code, body: res, error: 'unexpected_response' });
      }
    } catch (err) {
      console.error('Network or fetch error for uid=' + uid, err);
      results.push({ uid, ok: false, error: 'network_error', detail: String(err) });
    }
  }

  return { ok: true, results };
}
