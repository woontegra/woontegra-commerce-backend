import prisma from '../../config/database';
import { hashPassword, comparePassword } from '../../common/utils/password.util';
import { generateToken } from '../../common/utils/jwt.util';
import { AppError } from '../../common/middleware/error.middleware';

interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  tenantSlug: string;
}

interface LoginDto {
  email: string;
  password: string;
  tenantSlug: string;
}

export class AuthService {
  async register(data: RegisterDto) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: data.tenantSlug },
    });

    if (!tenant) {
      throw new AppError('Tenant not found', 404);
    }

    if (!tenant.isActive) {
      throw new AppError('Tenant is inactive', 403);
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        email_tenantId: {
          email: data.email,
          tenantId: tenant.id,
        },
      },
    });

    if (existingUser) {
      throw new AppError('User already exists', 409);
    }

    const hashedPassword = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        tenantId: tenant.id,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user,
      token,
    };
  }

  async login(data: LoginDto) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: data.tenantSlug },
    });

    if (!tenant) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!tenant.isActive) {
      throw new AppError('Tenant is inactive', 403);
    }

    const user = await prisma.user.findUnique({
      where: {
        email_tenantId: {
          email: data.email,
          tenantId: tenant.id,
        },
      },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.isActive) {
      throw new AppError('User is inactive', 403);
    }

    const isPasswordValid = await comparePassword(data.password, user.password);

    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateToken({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
      token,
    };
  }
}
