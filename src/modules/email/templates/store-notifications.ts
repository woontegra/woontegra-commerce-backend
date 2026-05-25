import { storeEmailLayout } from './store-layout';
import {
  escapeHtml,
  formatMoney,
  orderStatusEmailCopy,
  orderStatusLabel,
  resolveStoreName,
  returnTypeLabel,
  type StoreEmailBranding,
} from './store-email.util';

export type StoreOrderCreatedData = StoreEmailBranding & {
  customerName:   string;
  orderNumber:    string;
  itemsSubtotal:  number;
  shippingTotal:  number;
  grandTotal:     number;
  currency:       string;
  paymentMethod:  string;
  orderDetailUrl: string;
  storefrontUrl:  string;
};

export type StoreOrderCashOnDeliveryCreatedData = StoreEmailBranding & {
  customerName:       string;
  orderNumber:        string;
  orderDate:          string;
  paymentMethod:      string;
  itemsSubtotal:      number;
  shippingTotal:      number;
  cashOnDeliveryFee:  number;
  grandTotal:         number;
  currency:           string;
  orderDetailUrl:     string;
  storefrontUrl:      string;
};

export type StoreOrderPaymentReceivedData = StoreEmailBranding & {
  customerName:     string;
  orderNumber:      string;
  orderDate:        string;
  paymentMethod:    string;
  grandTotal:       number;
  currency:         string;
  orderDetailUrl:   string;
  storefrontUrl:    string;
};

export type StoreOrderBankTransferApprovedData = StoreEmailBranding & {
  customerName:   string;
  orderNumber:    string;
  orderDate:      string;
  paymentMethod:  string;
  grandTotal:     number;
  currency:       string;
  orderDetailUrl: string;
  storefrontUrl:  string;
};

export type StoreOrderBankTransferPendingData = StoreEmailBranding & {
  customerName:     string;
  orderNumber:      string;
  orderDate:        string;
  paymentMethod:    string;
  grandTotal:       number;
  currency:         string;
  bankName:         string;
  accountHolder:    string;
  iban:             string;
  paymentNote:      string;
  orderDetailUrl:   string;
  ordersListUrl:    string;
  storefrontUrl:    string;
};

export type StoreOrderPaymentFailedData = StoreEmailBranding & {
  customerName:     string;
  orderNumber:      string;
  orderDate:        string;
  paymentMethod:    string;
  grandTotal:       number;
  currency:         string;
  ordersListUrl:    string;
  storefrontUrl:    string;
};

export type StoreOrderStatusChangedData = StoreEmailBranding & {
  customerName:   string;
  orderNumber:    string;
  oldStatus:      string;
  newStatus:      string;
  orderDetailUrl: string;
};

export type StoreOrderStatusUpdatedData = StoreEmailBranding & {
  customerName:   string;
  orderNumber:    string;
  orderDate:      string;
  newStatus:      string;
  statusLabel:    string;
  statusHeadline: string;
  statusMessage:  string;
  grandTotal:     number;
  currency:       string;
  orderDetailUrl: string;
  storefrontUrl:  string;
  shippingCarrier?:        string | null;
  shippingTrackingNumber?: string | null;
  shippingTrackingUrl?:    string | null;
};

function renderShippingInfoBlock(data: StoreOrderStatusUpdatedData): string {
  if (data.newStatus !== 'SHIPPED') return '';

  const carrier = data.shippingCarrier?.trim();
  const tracking = data.shippingTrackingNumber?.trim();
  const url = data.shippingTrackingUrl?.trim();

  if (!carrier && !tracking && !url) {
    return `<p style="font-size:14px;color:#64748b">Takip bilgileri mağaza tarafından ayrıca paylaşılacaktır.</p>`;
  }

  const rows: string[] = [];
  if (carrier) {
    rows.push(`
      <div class="card-row">
        <span class="label">Kargo firması</span>
        <span class="value">${escapeHtml(carrier)}</span>
      </div>`);
  }
  if (tracking) {
    rows.push(`
      <div class="card-row">
        <span class="label">Takip numarası</span>
        <span class="value"><span class="font-mono">${escapeHtml(tracking)}</span></span>
      </div>`);
  }

  const trackBtn = url
    ? `<a href="${escapeHtml(url)}" class="btn" style="margin-top:12px">Kargomu Takip Et</a>`
    : '';

  return `
      <div class="card">
        ${rows.join('')}
      </div>
      ${trackBtn}`;
}

export type StoreReturnRequestCreatedData = StoreEmailBranding & {
  customerName:     string;
  requestNumber:    string;
  orderNumber:      string;
  requestType:      string;
  statusLabel:      string;
  requestDetailUrl: string;
};

export type StoreReturnRequestStatusChangedData = StoreEmailBranding & {
  customerName:     string;
  requestNumber:    string;
  orderNumber:      string;
  newStatusLabel:   string;
  adminNote?:       string | null;
  requestDetailUrl: string;
};

export type StoreReturnCompletedData = StoreEmailBranding & {
  customerName:     string;
  requestNumber:    string;
  orderNumber:      string;
  requestDetailUrl: string;
};

export type StoreRefundRecordedData = StoreEmailBranding & {
  customerName:     string;
  requestNumber:    string;
  orderNumber:      string;
  amount:           number;
  currency:         string;
  methodLabel:      string;
  refundedAt:       string;
  requestDetailUrl: string;
};

function brandingFrom(data: StoreEmailBranding): StoreEmailBranding {
  return {
    storeName:  resolveStoreName(data.storeName),
    logoUrl:    data.logoUrl ?? null,
    tenantSlug: data.tenantSlug,
  };
}

export function storeOrderCashOnDeliveryCreatedTemplate(data: StoreOrderCashOnDeliveryCreatedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);
  const codFee = data.cashOnDeliveryFee > 0 ? data.cashOnDeliveryFee : 0;

  const codFeeRow = codFee > 0
    ? `
        <div class="card-row">
          <span class="label">Kapıda ödeme ek ücreti</span>
          <span class="value">${formatMoney(codFee, data.currency)}</span>
        </div>`
    : `
        <p style="font-size:13px;color:#64748b;margin-top:8px">Kapıda ödeme ek ücreti varsa genel toplam tutara dahildir.</p>`;

  return {
    subject: `Siparişiniz alındı - Kapıda ödeme (#${data.orderNumber})`,
    html: storeEmailLayout(branding, 'Kapıda Ödeme Siparişi', `
      <h2>Siparişiniz alındı</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişiniz alınmıştır.</p>
      <p>Ödemenizi ürün teslimatı sırasında yapabilirsiniz.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ürün toplamı</span>
          <span class="value">${formatMoney(data.itemsSubtotal, data.currency)}</span>
        </div>
        <div class="card-row">
          <span class="label">Kargo</span>
          <span class="value">${formatMoney(data.shippingTotal, data.currency)}</span>
        </div>
        ${codFeeRow}
        <div class="card-row">
          <span class="label"><b>Genel toplam</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderCreatedTemplate(data: StoreOrderCreatedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);

  return {
    subject: `Siparişiniz alındı — #${data.orderNumber}`,
    html: storeEmailLayout(branding, 'Siparişiniz Alındı', `
      <h2>Siparişiniz alındı</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişiniz başarıyla oluşturuldu.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Ürün toplamı</span>
          <span class="value">${formatMoney(data.itemsSubtotal, data.currency)}</span>
        </div>
        <div class="card-row">
          <span class="label">Kargo</span>
          <span class="value">${formatMoney(data.shippingTotal, data.currency)}</span>
        </div>
        <div class="card-row">
          <span class="label"><b>Genel toplam</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Siparişi Görüntüle</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderBankTransferApprovedTemplate(data: StoreOrderBankTransferApprovedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);

  return {
    subject: `Ödemeniz onaylandı - #${data.orderNumber}`,
    html: storeEmailLayout(branding, 'Ödeme Onaylandı', `
      <h2>Ödemeniz onaylandı</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişiniz için havale/EFT ödemeniz mağaza tarafından onaylandı.</p>
      <p>Siparişiniz hazırlık sürecine alınacaktır.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
        <div class="card-row">
          <span class="label"><b>Sipariş toplamı</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderBankTransferPendingTemplate(data: StoreOrderBankTransferPendingData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);
  const ibanDisplay = escapeHtml(data.iban.replace(/\s/g, '').toUpperCase());

  return {
    subject: `Havale/EFT ödeme bilgileriniz - #${data.orderNumber}`,
    html: storeEmailLayout(branding, 'Ödeme Bekleniyor', `
      <h2>Ödeme bekleniyor</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişiniz için havale/EFT ile ödeme beklenmektedir.</p>
      <p>Ödemenizin eşleştirilebilmesi için açıklama alanına sipariş numaranızı yazmanız önerilir: <strong>#${escapeHtml(data.orderNumber)}</strong></p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
        <div class="card-row">
          <span class="label"><b>Sipariş toplamı</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      <div class="card">
        <div class="card-row">
          <span class="label">Banka</span>
          <span class="value">${escapeHtml(data.bankName)}</span>
        </div>
        <div class="card-row">
          <span class="label">Hesap sahibi</span>
          <span class="value">${escapeHtml(data.accountHolder)}</span>
        </div>
        <div class="card-row">
          <span class="label">IBAN</span>
          <span class="value"><span class="font-mono">${ibanDisplay}</span></span>
        </div>
        ${data.paymentNote.trim() ? `
        <div class="card-row">
          <span class="label">Ödeme notu</span>
          <span class="value">${escapeHtml(data.paymentNote)}</span>
        </div>` : ''}
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
      <p style="font-size:13px;color:#94a3b8;margin-top:12px">
        <a href="${escapeHtml(data.ordersListUrl)}">Siparişlerim</a> ·
        <a href="${escapeHtml(data.storefrontUrl)}">${store}</a>
      </p>
    `),
  };
}

export function storeOrderPaymentFailedTemplate(data: StoreOrderPaymentFailedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);

  return {
    subject: `Ödeme tamamlanamadı - #${data.orderNumber}`,
    html: storeEmailLayout(branding, 'Ödeme Tamamlanamadı', `
      <h2>Ödeme tamamlanamadı</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı sipariş için ödeme işlemi tamamlanamadı.</p>
      <p>Siparişiniz için ödeme işlemi tamamlanamadı. Kartınızdan ödeme alınmadıysa yeniden sipariş oluşturabilir veya mağaza ile iletişime geçebilirsiniz.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
        <div class="card-row">
          <span class="label"><b>Sipariş toplamı</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      <a href="${escapeHtml(data.ordersListUrl)}" class="btn">Siparişlerim</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderPaymentReceivedTemplate(data: StoreOrderPaymentReceivedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);

  return {
    subject: `Ödemeniz alındı — Siparişiniz oluşturuldu (#${data.orderNumber})`,
    html: storeEmailLayout(branding, 'Ödeme Alındı', `
      <h2>Ödemeniz alındı</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişiniz için ödemeniz başarıyla alınmıştır.</p>
      <p>Siparişiniz mağaza tarafından hazırlanacaktır.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Ödeme yöntemi</span>
          <span class="value">${escapeHtml(data.paymentMethod)}</span>
        </div>
        <div class="card-row">
          <span class="label"><b>Sipariş toplamı</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderStatusUpdatedTemplate(data: StoreOrderStatusUpdatedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const store = escapeHtml(branding.storeName);
  const copy = orderStatusEmailCopy(data.newStatus, data.orderNumber);

  return {
    subject: copy.subject,
    html: storeEmailLayout(branding, copy.headline, `
      <h2>${escapeHtml(copy.headline)}</h2>
      <p>Merhaba ${name}, <strong>${store}</strong> mağazasından verdiğiniz <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişinizle ilgili bir güncelleme var.</p>
      <p>${escapeHtml(copy.message)}</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş tarihi</span>
          <span class="value">${escapeHtml(data.orderDate)}</span>
        </div>
        <div class="card-row">
          <span class="label">Durum</span>
          <span class="value"><span class="badge">${escapeHtml(data.statusLabel)}</span></span>
        </div>
        <div class="card-row">
          <span class="label"><b>Sipariş toplamı</b></span>
          <span class="value"><b>${formatMoney(data.grandTotal, data.currency)}</b></span>
        </div>
      </div>
      ${renderShippingInfoBlock(data)}
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
      <p style="font-size:13px;color:#94a3b8">Mağaza: <a href="${escapeHtml(data.storefrontUrl)}">${store}</a></p>
    `),
  };
}

export function storeOrderStatusChangedTemplate(data: StoreOrderStatusChangedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const oldLabel = escapeHtml(orderStatusLabel(data.oldStatus));
  const newLabel = escapeHtml(orderStatusLabel(data.newStatus));

  return {
    subject: `Sipariş durumu güncellendi — #${data.orderNumber}`,
    html: storeEmailLayout(branding, 'Sipariş Durumu', `
      <h2>Sipariş durumunuz güncellendi</h2>
      <p>Merhaba ${name}, <strong>#${escapeHtml(data.orderNumber)}</strong> numaralı siparişinizin durumu değiştirildi.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Önceki durum</span>
          <span class="value">${oldLabel}</span>
        </div>
        <div class="card-row">
          <span class="label">Yeni durum</span>
          <span class="value"><span class="badge">${newLabel}</span></span>
        </div>
      </div>
      <a href="${escapeHtml(data.orderDetailUrl)}" class="btn">Sipariş Detayı</a>
    `),
  };
}

export function storeReturnRequestCreatedTemplate(data: StoreReturnRequestCreatedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');

  return {
    subject: `Talebiniz alındı — ${data.requestNumber}`,
    html: storeEmailLayout(branding, 'Talep Alındı', `
      <h2>Talebiniz alındı</h2>
      <p>Merhaba ${name}, talebiniz mağazamıza ulaştı ve inceleniyor.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Talep no</span>
          <span class="value">${escapeHtml(data.requestNumber)}</span>
        </div>
        <div class="card-row">
          <span class="label">Sipariş no</span>
          <span class="value">#${escapeHtml(data.orderNumber)}</span>
        </div>
        <div class="card-row">
          <span class="label">Talep türü</span>
          <span class="value">${escapeHtml(returnTypeLabel(data.requestType))}</span>
        </div>
        <div class="card-row">
          <span class="label">Durum</span>
          <span class="value"><span class="badge">${escapeHtml(data.statusLabel)}</span></span>
        </div>
      </div>
      <a href="${escapeHtml(data.requestDetailUrl)}" class="btn">Talep Detayı</a>
    `),
  };
}

export function storeReturnRequestStatusChangedTemplate(data: StoreReturnRequestStatusChangedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');
  const noteBlock = data.adminNote?.trim()
    ? `<div class="note"><strong>Mağaza notu:</strong> ${escapeHtml(data.adminNote.trim())}</div>`
    : '';

  return {
    subject: `Talep durumu güncellendi — ${data.requestNumber}`,
    html: storeEmailLayout(branding, 'Talep Durumu', `
      <h2>Talep durumunuz güncellendi</h2>
      <p>Merhaba ${name}, <strong>${escapeHtml(data.requestNumber)}</strong> numaralı talebinizin durumu güncellendi.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş no</span>
          <span class="value">#${escapeHtml(data.orderNumber)}</span>
        </div>
        <div class="card-row">
          <span class="label">Yeni durum</span>
          <span class="value"><span class="badge">${escapeHtml(data.newStatusLabel)}</span></span>
        </div>
      </div>
      ${noteBlock}
      <a href="${escapeHtml(data.requestDetailUrl)}" class="btn">Talep Detayı</a>
    `),
  };
}

export function storeReturnCompletedTemplate(data: StoreReturnCompletedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');

  return {
    subject: `İade süreciniz tamamlandı — ${data.requestNumber}`,
    html: storeEmailLayout(branding, 'İade Tamamlandı', `
      <h2>İade süreciniz tamamlandı</h2>
      <p>Merhaba ${name}, <strong>${escapeHtml(data.requestNumber)}</strong> numaralı iade talebiniz tamamlandı.</p>
      <p>Seçili ürünler mağaza stoğuna iade edildi. Ödeme iadesi mağaza tarafından ayrıca işlenecektir; banka hesabınıza yansıma süresi ödeme yönteminize göre değişebilir.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Sipariş no</span>
          <span class="value">#${escapeHtml(data.orderNumber)}</span>
        </div>
      </div>
      <a href="${escapeHtml(data.requestDetailUrl)}" class="btn">Talep Detayı</a>
    `),
  };
}

export function storeRefundRecordedTemplate(data: StoreRefundRecordedData) {
  const branding = brandingFrom(data);
  const name = escapeHtml(data.customerName.trim() || 'Değerli Müşterimiz');

  return {
    subject: `Ödeme iadesi kaydı — ${data.requestNumber}`,
    html: storeEmailLayout(branding, 'Ödeme İadesi Kaydı', `
      <h2>Ödeme iadesi kaydı oluşturuldu</h2>
      <p>Merhaba ${name}, mağaza tarafından ödeme iadesi kaydı oluşturuldu.</p>
      <div class="card">
        <div class="card-row">
          <span class="label">Talep no</span>
          <span class="value">${escapeHtml(data.requestNumber)}</span>
        </div>
        <div class="card-row">
          <span class="label">Sipariş no</span>
          <span class="value">#${escapeHtml(data.orderNumber)}</span>
        </div>
        <div class="card-row">
          <span class="label">İade tutarı</span>
          <span class="value">${formatMoney(data.amount, data.currency)}</span>
        </div>
        <div class="card-row">
          <span class="label">Tarih</span>
          <span class="value">${escapeHtml(data.refundedAt)}</span>
        </div>
        <div class="card-row">
          <span class="label">Yöntem</span>
          <span class="value">${escapeHtml(data.methodLabel)}</span>
        </div>
      </div>
      <p style="font-size:13px;color:#64748b">Bu kayıt mağaza tarafından oluşturulmuştur. Banka hesabınıza yansıma süresi ödeme yönteminize ve bankanıza göre değişebilir.</p>
      <a href="${escapeHtml(data.requestDetailUrl)}" class="btn">Talep Detayı</a>
    `),
  };
}
