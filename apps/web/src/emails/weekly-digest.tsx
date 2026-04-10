import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Preview,
  Img,
  Row,
  Column,
} from "@react-email/components";
import * as React from "react";

// ---------- Types ----------

export interface DigestPattern {
  readonly name: string;
  readonly occurrencesThisWeek: number;
  readonly occurrencesLastWeek: number;
  readonly totalHours: number;
  readonly sources: readonly string[];
  readonly sparkline: readonly number[]; // 7 data points, one per day
}

export interface NewPatternAlert {
  readonly name: string;
  readonly detectedOn: string;
  readonly sources: readonly string[];
}

export interface ExportReadyPattern {
  readonly name: string;
  readonly confidence: number;
  readonly exportUrl: string;
}

export interface WeeklyDigestProps {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly userName: string;
  readonly topPatterns: readonly DigestPattern[];
  readonly newPatterns: readonly NewPatternAlert[];
  readonly exportReady: readonly ExportReadyPattern[];
  readonly unsubscribeUrl: string;
  readonly dashboardUrl: string;
}

// ---------- Helpers ----------

const colors = {
  bg: "#0a0a0f",
  cardBg: "#12121a",
  cardBorder: "#1e1e2e",
  text: "#e4e4e7",
  textMuted: "#71717a",
  accent: "#818cf8",
  accentMuted: "#6366f1",
  green: "#4ade80",
  red: "#f87171",
  orange: "#fb923c",
  white: "#ffffff",
} as const;

function trendText(current: number, previous: number): string {
  if (previous === 0) return "new this week";
  const diff = current - previous;
  if (diff > 0) return `up from ${previous}\u00d7 last week`;
  if (diff < 0) return `down from ${previous}\u00d7 last week`;
  return "same as last week";
}

function trendColor(current: number, previous: number): string {
  if (current > previous) return colors.green;
  if (current < previous) return colors.red;
  return colors.textMuted;
}

function formatHours(h: number): string {
  return h < 1 ? `${Math.round(h * 60)} min` : `~${h.toFixed(1)} hrs`;
}

function sparklineSvg(data: readonly number[]): string {
  if (data.length === 0) return "";
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 28;
  const step = w / (data.length - 1 || 1);
  const points = data
    .map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`)
    .join(" ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<polyline points="${points}" fill="none" stroke="${colors.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join("");
}

function sourceLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Component ----------

export function WeeklyDigest({
  weekStart,
  weekEnd,
  userName,
  topPatterns,
  newPatterns,
  exportReady,
  unsubscribeUrl,
  dashboardUrl,
}: WeeklyDigestProps) {
  return (
    <Html>
      <Head />
      <Preview>Your Week in Patterns - {weekStart} to {weekEnd}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <table width="100%" cellPadding={0} cellSpacing={0}>
              <tbody>
                <tr>
                  <td>
                    <Text style={logoStyle}>
                      <span style={{ color: colors.accent }}>{"{"}</span>wm
                      <span style={{ color: colors.accent }}>{"}"}</span>
                    </Text>
                  </td>
                  <td align="right">
                    <Text style={dateRangeStyle}>
                      {weekStart} &mdash; {weekEnd}
                    </Text>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* Narrative Intro */}
          <Section style={sectionStyle}>
            <Text style={headingStyle}>Your Week in Patterns</Text>
            <Text style={narrativeStyle}>
              Hey {userName}, here&apos;s what Workflow Miner noticed about your
              work rhythms this week. We tracked{" "}
              {topPatterns.reduce((sum, p) => sum + p.occurrencesThisWeek, 0)}{" "}
              pattern occurrences across your connected tools.
            </Text>
          </Section>

          <Hr style={dividerStyle} />

          {/* Top Patterns */}
          <Section style={sectionStyle}>
            <Text style={sectionTitleStyle}>Top Patterns</Text>
            {topPatterns.map((pattern, i) => (
              <Section key={i} style={cardStyle}>
                <table width="100%" cellPadding={0} cellSpacing={0}>
                  <tbody>
                    <tr>
                      <td>
                        <Text style={patternNameStyle}>{pattern.name}</Text>
                      </td>
                      <td align="right" width="130">
                        <Img
                          src={`data:image/svg+xml;base64,${Buffer.from(sparklineSvg(pattern.sparkline)).toString("base64")}`}
                          width="120"
                          height="28"
                          alt={`${pattern.name} trend`}
                          style={{ display: "block" }}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <Text style={patternNarrativeStyle}>
                  You ran this loop{" "}
                  <strong style={{ color: colors.white }}>
                    {pattern.occurrencesThisWeek}&times;
                  </strong>{" "}
                  this week, spending{" "}
                  <strong style={{ color: colors.white }}>
                    {formatHours(pattern.totalHours)}
                  </strong>{" "}
                  total.{" "}
                  <span
                    style={{
                      color: trendColor(
                        pattern.occurrencesThisWeek,
                        pattern.occurrencesLastWeek,
                      ),
                    }}
                  >
                    {trendText(
                      pattern.occurrencesThisWeek,
                      pattern.occurrencesLastWeek,
                    )}
                  </span>
                  .
                </Text>
                <Text style={sourceTagsStyle}>
                  {pattern.sources.map(sourceLabel).join(" \u00b7 ")}
                </Text>
              </Section>
            ))}
          </Section>

          {/* New Pattern Alerts */}
          {newPatterns.length > 0 && (
            <>
              <Hr style={dividerStyle} />
              <Section style={sectionStyle}>
                <Text style={sectionTitleStyle}>
                  <span style={{ color: colors.orange }}>&#9679;</span> New
                  Patterns Detected
                </Text>
                {newPatterns.map((np, i) => (
                  <Section key={i} style={alertCardStyle}>
                    <Text style={alertNameStyle}>{np.name}</Text>
                    <Text style={alertMetaStyle}>
                      First seen {np.detectedOn} &middot;{" "}
                      {np.sources.map(sourceLabel).join(", ")}
                    </Text>
                  </Section>
                ))}
              </Section>
            </>
          )}

          {/* Export Ready */}
          {exportReady.length > 0 && (
            <>
              <Hr style={dividerStyle} />
              <Section style={sectionStyle}>
                <Text style={sectionTitleStyle}>Ready to Export</Text>
                <Text style={narrativeStyle}>
                  These patterns are above the confidence threshold and can be
                  exported as deployable skill packs.
                </Text>
                {exportReady.map((ep, i) => (
                  <Section key={i} style={exportCardStyle}>
                    <Row>
                      <Column>
                        <Text style={exportNameStyle}>{ep.name}</Text>
                        <Text style={exportConfidenceStyle}>
                          {ep.confidence}% confidence
                        </Text>
                      </Column>
                      <Column align="right" style={{ verticalAlign: "middle" }}>
                        <Link href={ep.exportUrl} style={ctaButtonStyle}>
                          Export
                        </Link>
                      </Column>
                    </Row>
                  </Section>
                ))}
              </Section>
            </>
          )}

          <Hr style={dividerStyle} />

          {/* Dashboard CTA */}
          <Section style={{ ...sectionStyle, textAlign: "center" as const }}>
            <Link href={dashboardUrl} style={dashboardButtonStyle}>
              View Full Dashboard &rarr;
            </Link>
          </Section>

          {/* Footer */}
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              Workflow Miner &middot; Detect patterns. Export skills.
            </Text>
            <Text style={footerTextStyle}>
              <Link href={unsubscribeUrl} style={unsubscribeLinkStyle}>
                Unsubscribe from weekly digests
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ---------- Styles ----------

const bodyStyle: React.CSSProperties = {
  backgroundColor: colors.bg,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: 0,
  padding: 0,
};

const containerStyle: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "0 16px",
};

const headerStyle: React.CSSProperties = {
  padding: "32px 0 16px",
};

const logoStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: colors.white,
  margin: 0,
  fontFamily: "monospace",
};

const dateRangeStyle: React.CSSProperties = {
  fontSize: "13px",
  color: colors.textMuted,
  margin: 0,
};

const sectionStyle: React.CSSProperties = {
  padding: "16px 0",
};

const headingStyle: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: colors.white,
  margin: "0 0 8px",
  lineHeight: "1.3",
};

const narrativeStyle: React.CSSProperties = {
  fontSize: "15px",
  color: colors.textMuted,
  lineHeight: "1.6",
  margin: "0 0 8px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: colors.accent,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 12px",
};

const dividerStyle: React.CSSProperties = {
  borderTop: `1px solid ${colors.cardBorder}`,
  margin: "8px 0",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: colors.cardBg,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const patternNameStyle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: colors.white,
  margin: "0 0 6px",
};

const patternNarrativeStyle: React.CSSProperties = {
  fontSize: "14px",
  color: colors.text,
  lineHeight: "1.5",
  margin: "0 0 6px",
};

const sourceTagsStyle: React.CSSProperties = {
  fontSize: "12px",
  color: colors.textMuted,
  margin: 0,
};

const alertCardStyle: React.CSSProperties = {
  backgroundColor: colors.cardBg,
  borderLeft: `3px solid ${colors.orange}`,
  borderRadius: "4px",
  padding: "12px 16px",
  marginBottom: "8px",
};

const alertNameStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: colors.white,
  margin: "0 0 4px",
};

const alertMetaStyle: React.CSSProperties = {
  fontSize: "13px",
  color: colors.textMuted,
  margin: 0,
};

const exportCardStyle: React.CSSProperties = {
  backgroundColor: colors.cardBg,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: "8px",
  padding: "14px 16px",
  marginBottom: "8px",
};

const exportNameStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: colors.white,
  margin: "0 0 2px",
};

const exportConfidenceStyle: React.CSSProperties = {
  fontSize: "13px",
  color: colors.green,
  margin: 0,
};

const ctaButtonStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: colors.accentMuted,
  color: colors.white,
  fontSize: "13px",
  fontWeight: 600,
  padding: "8px 20px",
  borderRadius: "6px",
  textDecoration: "none",
};

const dashboardButtonStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: colors.accent,
  color: "#0a0a0f",
  fontSize: "14px",
  fontWeight: 700,
  padding: "12px 32px",
  borderRadius: "8px",
  textDecoration: "none",
};

const footerStyle: React.CSSProperties = {
  padding: "24px 0 32px",
  textAlign: "center" as const,
};

const footerTextStyle: React.CSSProperties = {
  fontSize: "12px",
  color: colors.textMuted,
  margin: "0 0 4px",
  lineHeight: "1.5",
};

const unsubscribeLinkStyle: React.CSSProperties = {
  color: colors.textMuted,
  textDecoration: "underline",
};

export default WeeklyDigest;
