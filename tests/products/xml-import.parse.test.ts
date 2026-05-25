import { describe, it, expect } from 'vitest';
import { parseXmlToNodes, collectXmlFields } from '../../src/modules/products/xml-import.controller';

describe('parseXmlToNodes field discovery', () => {
  it('WooCommerce category iç içe XML’den category alanı çıkarır', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/">
  <channel>
    <wp:wxr_version>1.2</wp:wxr_version>
    <item>
      <title>Test Ürün</title>
      <wp:post_type>product</wp:post_type>
      <category domain="product_cat" nicename="mermer"><![CDATA[Mermer]]></category>
      <category domain="product_type" nicename="simple"><![CDATA[simple]]></category>
      <wp:postmeta>
        <wp:meta_key>_price</wp:meta_key>
        <wp:meta_value>310</wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_sku</wp:meta_key>
        <wp:meta_value>SKU-1</wp:meta_value>
      </wp:postmeta>
      <wp:postmeta>
        <wp:meta_key>_ahcpro_total_views</wp:meta_key>
        <wp:meta_value>6</wp:meta_value>
      </wp:postmeta>
    </item>
  </channel>
</rss>`;

    const { nodes, xmlFormat } = parseXmlToNodes(Buffer.from(xml, 'utf-8'));
    expect(xmlFormat).toBe('wordpress');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].category).toBe('Mermer');
    expect(nodes[0]._price).toBe('310');
    expect(nodes[0]._ahcpro_total_views).toBeUndefined();
  });

  it('collectXmlFields birleşim şişmesin — tek üründe sınırlı alan', () => {
    const xml = `<?xml version="1.0"?>
<catalog>
  <product>
    <name>A</name>
    <price>10</price>
    <category>Elektronik</category>
    <sku>S1</sku>
  </product>
  <product>
    <name>B</name>
    <price>20</price>
    <extra_only_on_b>yes</extra_only_on_b>
  </product>
</catalog>`;

    const { nodes } = parseXmlToNodes(Buffer.from(xml, 'utf-8'));
    expect(nodes.length).toBe(2);

    const fields = collectXmlFields(nodes, { xmlFormat: 'standard' });
    expect(fields).toContain('category');
    expect(fields).not.toContain('extra_only_on_b');
    expect(fields.length).toBeLessThanOrEqual(6);
  });

  it('WooCommerce: tek üründeki nadir postmeta tüm listeyi şişirmez', () => {
    const meta = (key: string, value: string) => `
      <wp:postmeta><wp:meta_key>${key}</wp:meta_key><wp:meta_value>${value}</wp:meta_value></wp:postmeta>`;

    const rareOnly = Array.from({ length: 40 }, (_, i) => meta(`_rare_plugin_${i}`, 'x')).join('');

    const item = (title: string, extraMeta: string) => `
    <item>
      <title>${title}</title>
      <wp:post_type>product</wp:post_type>
      <category domain="product_cat" nicename="cat"><![CDATA[Cat]]></category>
      ${meta('_price', '10')}
      ${meta('_sku', 'S')}
      ${extraMeta}
    </item>`;

    const xml = `<?xml version="1.0"?>
<rss xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <wp:wxr_version>1.2</wp:wxr_version>
    ${item('Ürün A', rareOnly)}
    ${item('Ürün B', '')}
    ${item('Ürün C', '')}
  </channel>
</rss>`;

    const { nodes, xmlFormat } = parseXmlToNodes(Buffer.from(xml, 'utf-8'));
    expect(xmlFormat).toBe('wordpress');
    const fields = collectXmlFields(nodes, { xmlFormat });
    expect(fields).toContain('category');
    expect(fields).toContain('_price');
    expect(fields).not.toContain('product_cat');
    expect(fields.some(f => f.startsWith('_rare_plugin_'))).toBe(false);
    expect(fields.length).toBeLessThan(30);
  });
});
