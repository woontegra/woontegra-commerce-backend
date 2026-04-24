import prisma from '../../config/database';

/**
 * Türkçe karakterleri İngilizce karakterlere dönüştürür
 */
function turkishToEnglish(text: string): string {
  const turkishChars: { [key: string]: string } = {
    'ğ': 'g',
    'ü': 'u',
    'ş': 's',
    'ı': 'i',
    'ö': 'o',
    'ç': 'c',
    'Ğ': 'g',
    'Ü': 'u',
    'Ş': 's',
    'İ': 'i',
    'Ö': 'o',
    'Ç': 'c'
  };
  
  return text.replace(/[ğüşıöçĞÜŞİÖÇ]/g, (char) => turkishChars[char] || char);
}

/**
 * Metni slug formatına dönüştürür
 * - Küçük harfe çevirir
 * - Türkçe karakterleri dönüştürür
 * - Alfanümerik olmayan karakterleri tire ile değiştirir
 * - Birden fazla tireyi tek tireye indirger
 * - Başındaki ve sonundaki tireleri temizler
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Boşlukları tire yap
    .replace(/[^\w\-]+/g, '') // Alfanümerik olmayanları temizle
    .replace(/\-\-+/g, '-') // Birden fazla tireyi tek tire yap
    .replace(/^-+/, '') // Baştaki tireleri temizle
    .replace(/-+$/, ''); // Sondaki tireleri temizle
}

/**
 * Türkçe metinden SEO uyumlu slug oluşturur
 */
export function generateSEOSlug(text: string): string {
  // Önce Türkçe karakterleri dönüştür
  const englishText = turkishToEnglish(text);
  
  // Sonra slug oluştur
  return generateSlug(englishText);
}

/**
 * Ürün için unique slug oluşturur
 * Eğer slug zaten varsa sonuna sayı ekler
 */
export async function generateUniqueProductSlug(baseText: string, tenantId: string, excludeId?: string): Promise<string> {
  let baseSlug = generateSEOSlug(baseText);
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    // Slug'ın veritabanında olup olmadığını kontrol et
    const existing = await prisma.product.findFirst({
      where: {
        slug,
        tenantId,
        ...(excludeId && { id: { not: excludeId } })
      }
    });
    
    if (!existing) {
      return slug;
    }
    
    // Eğer slug varsa sonuna sayı ekle
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/**
 * Kategori için unique slug oluşturur
 * Eğer slug zaten varsa sonuna sayı ekler
 */
export async function generateUniqueCategorySlug(baseText: string, tenantId: string, excludeId?: string): Promise<string> {
  let baseSlug = generateSEOSlug(baseText);
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    // Slug'ın veritabanında olup olmadığını kontrol et
    const existing = await prisma.category.findFirst({
      where: {
        slug,
        tenantId,
        ...(excludeId && { id: { not: excludeId } })
      }
    });
    
    if (!existing) {
      return slug;
    }
    
    // Eğer slug varsa sonuna sayı ekle
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/**
 * Mevcut slug'ı günceller (text değiştiğinde kullanılır)
 */
export async function updateProductSlug(productId: string, newText: string, tenantId: string): Promise<string> {
  const newSlug = await generateUniqueProductSlug(newText, tenantId, productId);
  
  await prisma.product.update({
    where: { id: productId },
    data: { slug: newSlug }
  });
  
  return newSlug;
}

/**
 * Mevcut kategori slug'ını günceller
 */
export async function updateCategorySlug(categoryId: string, newText: string, tenantId: string): Promise<string> {
  const newSlug = await generateUniqueCategorySlug(newText, tenantId, categoryId);
  
  await prisma.category.update({
    where: { id: categoryId },
    data: { slug: newSlug }
  });
  
  return newSlug;
}
