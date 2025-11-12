import { Price } from '~/components/products/Price';
import { OrderDetailFragment } from '~/generated/graphql';
import { useTranslation } from 'react-i18next';

export function CartTotals({ order }: { order?: OrderDetailFragment | null }) {
  const { t } = useTranslation();

  export function CartTotals({ order }: { order?: OrderDetailFragment | null }) {
  const { t } = useTranslation();

  console.log("=== CartTotals DEBUG ===", {
    subTotal: order?.subTotal,
    subTotalWithTax: order?.subTotalWithTax,
    shippingWithTax: order?.shippingWithTax,
    totalWithTax: order?.totalWithTax,
    discounts: order?.discounts?.map(d => ({
      amountWithTax: d.amountWithTax,
      description: (d as any).description
    })),
    lines: order?.lines?.map(l => ({
      name: l.productVariant.name,
      quantity: l.quantity,
      unitPriceWithTax: l.unitPriceWithTax,
      discountedUnitPriceWithTax: l.discountedUnitPriceWithTax,
      linePriceWithTax: l.linePriceWithTax,
      discountedLinePriceWithTax: l.discountedLinePriceWithTax,
      lineDiscounts: l.discounts?.map(d => d.amountWithTax)
    }))
  });


  return (
    <dl className="border-t mt-6 border-gray-200 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <dt className="text-sm">{t('common.subtotal')}</dt>
        <dd className="text-sm font-medium text-gray-900">
          <Price
            priceWithTax={order?.subTotalWithTax}
            currencyCode={order?.currencyCode}
          ></Price>
        </dd>
      </div>
      <div className="flex items-center justify-between">
        <dt className="text-sm">{t('common.shipping')}</dt>
        <dd className="text-sm font-medium text-gray-900">
          <Price
            priceWithTax={order?.shippingWithTax ?? 0}
            currencyCode={order?.currencyCode}
          ></Price>
        </dd>
      </div>
      <div className="flex items-center justify-between border-t border-gray-200 pt-6">
        <dt className="text-base font-medium">{t('common.total')}</dt>
        <dd className="text-base font-medium text-gray-900">
          <Price
            priceWithTax={order?.totalWithTax}
            currencyCode={order?.currencyCode}
          ></Price>
        </dd>
      </div>
    </dl>
  );
}
