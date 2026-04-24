import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: '7d',
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is not defined in environment variables');
}

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is not defined in environment variables');
}
