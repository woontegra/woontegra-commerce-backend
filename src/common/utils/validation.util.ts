export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$/;
  return emailRegex.test(email);
};

export const validateSubdomain = (subdomain: string): boolean => {
  // Only lowercase letters, numbers, and hyphens
  const subdomainRegex = /^[a-z0-9-]+$/;
  return subdomainRegex.test(subdomain) && subdomain.length >= 3 && subdomain.length <= 50;
};

export const validatePassword = (password: string): boolean => {
  // At least 8 characters, one uppercase, one lowercase, one number, one special character
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

export const validateStoreName = (name: string): boolean => {
  return !!name && name.trim().length >= 2 && name.trim().length <= 100;
};

export const validateRequired = (value: any, fieldName: string): void => {
  if (!value || value.toString().trim() === '') {
    throw new Error(`${fieldName} is required`);
  }
};
