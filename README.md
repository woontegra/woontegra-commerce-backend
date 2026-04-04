# Woontegra E-Commerce SaaS Backend

Scalable multi-tenant e-commerce backend built with Node.js, TypeScript, Express, Prisma, and PostgreSQL.

## 🚀 Features

- **Multi-tenant Architecture**: Complete tenant isolation
- **JWT Authentication**: Secure token-based auth
- **Modular Structure**: Clean, maintainable code organization
- **Type Safety**: Full TypeScript support
- **Database ORM**: Prisma for type-safe database access
- **RESTful API**: Well-structured REST endpoints

## 📁 Project Structure

```
backend/
├── src/
│   ├── modules/          # Feature modules
│   │   ├── auth/         # Authentication module
│   │   ├── tenants/      # Tenant management
│   │   ├── products/     # Product management
│   │   └── customers/    # Customer management
│   ├── common/           # Shared utilities
│   │   ├── middleware/   # Express middlewares
│   │   └── utils/        # Helper functions
│   ├── config/           # Configuration files
│   └── main.ts           # Application entry point
├── prisma/
│   └── schema.prisma     # Database schema
└── package.json
```

## 🛠️ Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
```

Edit `.env` and update:
```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/woontegra"
JWT_SECRET="your-secret-key"
PORT=3000
```

3. **Initialize database:**
```bash
npm run prisma:generate
npm run prisma:migrate
```

## 🚀 Running the Server

**Development mode:**
```bash
npm run dev
```

**Production build:**
```bash
npm run build
npm start
```

## 📡 API Endpoints

### Health Check
- `GET /health` - Server health status

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Tenants
- `POST /api/tenants` - Create tenant
- `GET /api/tenants` - List all tenants
- `GET /api/tenants/:id` - Get tenant by ID

### Products (Protected)
- `GET /api/products` - List products
- `GET /api/products/:id` - Get product
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Customers (Protected)
- `GET /api/customers` - List customers
- `GET /api/customers/:id` - Get customer
- `POST /api/customers` - Create customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer

## 🔐 Authentication

Protected routes require JWT token in Authorization header:
```
Authorization: Bearer <token>
```

## 🏢 Multi-Tenant Usage

1. **Create a tenant:**
```bash
POST /api/tenants
{
  "name": "My Store",
  "slug": "my-store",
  "domain": "mystore.com"
}
```

2. **Register user for tenant:**
```bash
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "tenantSlug": "my-store"
}
```

3. **Login:**
```bash
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123",
  "tenantSlug": "my-store"
}
```

## 🗄️ Database Schema

The system includes:
- **Tenants**: Multi-tenant isolation
- **Users**: Per-tenant users with roles
- **Customers**: Customer management
- **Products**: Product catalog
- **Categories**: Product categorization
- **Orders**: Order management
- **OrderItems**: Order line items

## 🛡️ Security Features

- Password hashing with bcrypt
- JWT token authentication
- Tenant isolation middleware
- Input validation
- Error handling middleware

## 📦 Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Auth**: JWT + bcrypt

## 🔧 Development Tools

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio

## 📝 License

ISC
