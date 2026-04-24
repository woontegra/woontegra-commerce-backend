# Security Features

This document outlines the security measures implemented in the Woontegra E-Commerce Backend.

## 1. Rate Limiting

### API Rate Limiting
- **Limit**: 100 requests per 15 minutes per IP
- **Applied to**: All API endpoints
- **Purpose**: Prevent API abuse and DDoS attacks

### Authentication Rate Limiting
- **Limit**: 5 attempts per 15 minutes per IP
- **Applied to**: `/api/auth/register` and `/api/auth/login`
- **Purpose**: Prevent brute force attacks
- **Note**: Successful requests are not counted

### Password Reset Rate Limiting
- **Limit**: 3 attempts per hour per IP
- **Applied to**: Password reset endpoints
- **Purpose**: Prevent password reset abuse

## 2. Security Headers (Helmet)

### Content Security Policy (CSP)
- Default source: self only
- Style source: self + inline styles
- Script source: self only
- Image source: self + data URIs + HTTPS

### HTTP Strict Transport Security (HSTS)
- Max age: 1 year
- Include subdomains: Yes
- Preload: Yes

### Additional Headers
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block

## 3. CORS Configuration

### Allowed Origins
- Configurable via `ALLOWED_ORIGINS` environment variable
- Default: `http://localhost:5173,http://localhost:3000`
- Credentials: Enabled

### Allowed Methods
- GET, POST, PUT, PATCH, DELETE, OPTIONS

### Allowed Headers
- Content-Type, Authorization

## 4. Input Validation (Joi)

### Validation Schemas

#### Authentication
- **Email**: Valid email format, required
- **Password**: Minimum 8 characters, required
- **Names**: 2-50 characters, required

#### Products
- **Name**: 3-200 characters, required
- **Price**: Positive number, required
- **Stock**: Non-negative integer, required
- **Images**: Array of valid URIs

#### Orders
- **Items**: Minimum 1 item, required
- **Quantity**: Positive integer, required
- **Price**: Positive number, required

#### Tenants
- **Slug**: Lowercase letters, numbers, hyphens only
- **Domain**: Valid domain format

### Validation Error Response
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Please provide a valid email address"
    }
  ]
}
```

## 5. Input Sanitization

### XSS Prevention
- Removes `<script>` tags
- Removes `javascript:` protocols
- Removes event handlers (onclick, onerror, etc.)
- Applied to: Request body and query parameters

### Request Size Limiting
- Maximum request size: 10MB
- Applied to: All requests
- Response: 413 Payload Too Large

## 6. Authentication & Authorization

### JWT Tokens
- Stored in localStorage (client-side)
- Sent via Authorization header
- Validated on every protected route

### Middleware Chain
1. **authMiddleware**: Validates JWT token
2. **tenantMiddleware**: Validates tenant access
3. **Route handler**: Processes request

### Protected Routes
- All routes except `/health`, `/api/auth/register`, `/api/auth/login`

## 7. Multi-Tenant Security

### Tenant Isolation
- Every request is scoped to a tenant
- Users can only access their tenant's data
- Database queries include `tenantId` filter

### Tenant Validation
- Tenant must be active
- Tenant must exist
- User must belong to tenant

## 8. Environment Variables

### Required Variables
```env
DATABASE_URL="postgresql://..."
JWT_SECRET="your-secret-key"
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS="https://yourdomain.com"
```

### Security Best Practices
- Never commit `.env` file
- Use strong JWT_SECRET (min 32 characters)
- Rotate secrets regularly
- Use different secrets for dev/prod

## 9. Error Handling

### Production Mode
- Generic error messages
- No stack traces
- Logged server-side

### Development Mode
- Detailed error messages
- Stack traces included
- Helpful debugging info

## 10. Best Practices

### Password Security
- Hashed with bcrypt
- Salt rounds: 10
- Never stored in plain text

### SQL Injection Prevention
- Prisma ORM parameterized queries
- No raw SQL queries

### CSRF Protection
- SameSite cookies (if using cookies)
- CORS restrictions

## 11. Monitoring & Logging

### Rate Limit Events
- Logged when limits are exceeded
- IP addresses tracked
- Timestamps recorded

### Authentication Events
- Failed login attempts logged
- Successful logins logged
- Token validation failures logged

## 12. Deployment Security

### Railway Configuration
- Environment variables encrypted
- HTTPS enforced
- Database connection encrypted

### Recommendations
- Enable 2FA for Railway account
- Use Railway's private networking
- Regular security audits
- Keep dependencies updated

## 13. Security Checklist

- [x] Rate limiting implemented
- [x] Helmet security headers configured
- [x] CORS properly configured
- [x] Input validation with Joi
- [x] XSS sanitization
- [x] Request size limiting
- [x] JWT authentication
- [x] Multi-tenant isolation
- [x] Password hashing
- [x] Error handling
- [ ] CSRF tokens (if using cookies)
- [ ] API key rotation
- [ ] Security audit logging
- [ ] Penetration testing

## 14. Reporting Security Issues

If you discover a security vulnerability, please email: security@woontegra.com

Do NOT create a public GitHub issue.
