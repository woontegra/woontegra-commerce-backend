import { Request, Response } from 'express';
import prisma from '../../config/database';

// ── XML builder ───────────────────────────────────────────────────────────────

function esc(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name: string, value: any): string {
  return `    <${name}>${esc(value)}</${name}>\n`;
}

function buildXml(products: any[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<Products>\n';

  for (const p of products) {
    const price    = p.pricing?.salePrice     ?? p.price ?? '';
    const discount = p.pricing?.discountPrice ?? '';
    const stock    = p.stock?.quantity        ?? '';
    const category = p.category?.name        ?? '';

    xml += '  <Product>\n';
    xml += tag('Name',         p.name);
    xml += tag('Barcode',      p.barcode);
    xml += tag('SKU',          p.sku);
    xml += tag('Brand',        p.brand);
    xml += tag('Unit',         p.unit);
    xml += tag('Price',        price);
    xml += tag('DiscountPrice',discount);
    xml += tag('Stock',        stock);
    xml += tag('Description',  p.description);
    xml += tag('Category',     category);
    xml += tag('Status',       p.status);

    // Images
    const images = [
      ...(p.productImages ?? []).map((i: any) => i.url),
      ...(p.images        ?? []).filter(Boolean),
    ].slice(0, 8);

    if (images.length > 0) {
      xml += '    <Images>\n';
      for (const url of images) {
        xml += `      <Image>${esc(url)}</Image>\n`;
      }
      xml += '    </Images>\n';
    }

    // Variants
    const variants = p.variants ?? [];
    if (variants.length > 0) {
      xml += '    <Variants>\n';
      for (const v of variants) {
        xml += '      <Variant>\n';
        xml += `        <SKU>${esc(v.sku)}</SKU>\n`;
        xml += `        <Barcode>${esc(v.barcode)}</Barcode>\n`;
        xml += `        <Price>${esc(v.price)}</Price>\n`;
        xml += `        <DiscountPrice>${esc(v.discountPrice)}</DiscountPrice>\n`;
        xml += `        <Stock>${esc(v.stockQuantity)}</Stock>\n`;
        xml += `        <IsActive>${esc(v.isActive)}</IsActive>\n`;

        // Variant attributes
        if (v.variantAttributes?.length > 0) {
          xml += `        <Attributes>\n`;
          for (const va of v.variantAttributes) {
            const attrName  = va.attribute?.name ?? '';
            const attrValue = va.attributeValue?.label ?? va.textValue ?? '';
            xml += `          <Attribute name="${esc(attrName)}">${esc(attrValue)}</Attribute>\n`;
          }
          xml += `        </Attributes>\n`;
        }

        xml += '      </Variant>\n';
      }
      xml += '    </Variants>\n';
    }

    xml += '  </Product>\n';
  }

  xml += '</Products>';
  return xml;
}

// ── Controller ────────────────────────────────────────────────────────────────

export const exportXml = async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = (req as any).user?.tenantId as string;
    if (!tenantId) {
      res.status(401).json({ error: 'Yetkisiz erişim.' });
      return;
    }

    // Optional filters
    const { status, categoryId } = req.query as Record<string, string>;
    const where: any = { tenantId };
    if (status)     where.status     = status;
    if (categoryId) where.categoryId = categoryId;

    // Fetch all products (no pagination — stream all)
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        pricing:      { select: { salePrice: true, discountPrice: true } },
        stock:        { select: { quantity: true } },
        category:     { select: { name: true } },
        productImages:{ select: { url: true }, orderBy: { order: 'asc' } },
        variants: {
          where:   { isActive: true },
          orderBy: { createdAt: 'asc' },
          include: {
            variantAttributes: {
              include: {
                attribute:      { select: { name: true } },
                attributeValue: { select: { label: true } },
              },
            },
          },
        },
      },
    });

    const xml = buildXml(products);

    const filename = `woontegra-products-${new Date().toISOString().slice(0, 10)}.xml`;

    res.setHeader('Content-Type',        'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      Buffer.byteLength(xml, 'utf-8'));
    res.send(xml);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'XML export başarısız.' });
  }
};
