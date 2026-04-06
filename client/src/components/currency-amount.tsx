import { cn } from "@/lib/utils";
import { type CurrencyCode, useCurrency } from "@/lib/currency";

type CurrencyAmountProps = {
  amountUsd: number;
  variant?: "inline" | "stacked";
  primaryClassName?: string;
  secondaryClassName?: string;
  className?: string;
  secondaryPrefix?: string;
  forcePrimaryCurrency?: CurrencyCode;
  showSecondary?: boolean;
} & React.HTMLAttributes<HTMLDivElement | HTMLSpanElement>;

export function CurrencyAmount({
  amountUsd,
  variant = "inline",
  primaryClassName,
  secondaryClassName,
  className,
  secondaryPrefix,
  forcePrimaryCurrency,
  showSecondary = false,
  ...props
}: CurrencyAmountProps) {
  const { selectedCurrency, alternateCurrency, formatAmount } = useCurrency();
  const primaryCurrency = forcePrimaryCurrency ?? selectedCurrency;
  const secondaryCurrency = primaryCurrency === selectedCurrency ? alternateCurrency : selectedCurrency;
  const primaryText = formatAmount(amountUsd, primaryCurrency);
  const secondaryBaseText = formatAmount(amountUsd, secondaryCurrency);
  const secondaryText = secondaryPrefix !== undefined
    ? `${secondaryPrefix}${secondaryBaseText}`
    : variant === "stacked"
      ? secondaryBaseText
      : `(${secondaryBaseText})`;

  if (variant === "stacked") {
    return (
      <div className={className} {...props}>
        <div className={primaryClassName}>{primaryText}</div>
        {showSecondary ? <div className={secondaryClassName}>{secondaryText}</div> : null}
      </div>
    );
  }

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)} {...props}>
      <span className={primaryClassName}>{primaryText}</span>
      {showSecondary ? <span className={secondaryClassName}>{secondaryText}</span> : null}
    </span>
  );
}
