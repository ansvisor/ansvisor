import supabaseAdmin from '../config/supabase.js';

class Middleware {
  async decodeTokenForSocket(socket, next) {
    try {
      const token = socket?.handshake?.query?.authorization;

      if (!token) {
        return next(new Error('Missing authorization token'));
      }

      const {
        data: { user },
        error,
      } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        console.log('Unauthorized Socket Request');
        return next(new Error('Unauthorized'));
      }

      socket.user = user;
      return next();
    } catch (e) {
      console.log('Internal Error (Socket Middleware):', e.message);
      return next(new Error('Internal Error'));
    }
  }

  async decodeToken(req, res, next) {
    try {
      const token = req?.headers?.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({ message: 'Missing authorization token' });
      }

      const {
        data: { user },
        error,
      } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ message: 'Unauthorized API Request' });
      }

      req.user = user;
      return next();
    } catch {
      return res.status(500).json({ message: 'Internal Error' });
    }
  }

  async checkRequestIsComingFromDomain(req, res, next) {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    try {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      const domain = req?.headers?.referer || req?.headers?.origin;

      if (!domain) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const url = new URL(domain);

      const isAllowed = allowedOrigins.some((origin) => {
        const allowed = new URL(origin);
        return url.hostname === allowed.hostname;
      });

      if (isAllowed) {
        return next();
      }

      return res.status(403).json({ message: 'Forbidden' });
    } catch (error) {
      console.log('Domain check error:', error.message);
      return res.status(500).json({ message: 'Internal Error' });
    }
  }

  async checkRequestIsComingFromDomainForSocket(socket, next) {
    if (process.env.NODE_ENV === 'development') {
      return next();
    }

    try {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      const domain = socket?.handshake?.headers?.referer || socket?.handshake?.headers?.origin;

      if (!domain) {
        return next(new Error('Forbidden Socket'));
      }

      const url = new URL(domain);

      const isAllowed = allowedOrigins.some((origin) => {
        const allowed = new URL(origin);
        return url.hostname === allowed.hostname;
      });

      if (isAllowed) {
        return next();
      }

      return next(new Error('Forbidden Socket'));
    } catch (error) {
      console.log('Socket domain check error:', error.message);
      return next(new Error('Internal Error Socket'));
    }
  }
}

export default new Middleware();
