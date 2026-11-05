/**
 * Incremental RFC 4180 parser for SDMX-CSV.
 *
 * Fed in arbitrary chunks so a 30 MB download never has to sit in memory as
 * one string. Handles quoted fields with embedded commas, newlines and
 * doubled quotes (free-text attributes such as OBS_COMMENT carry all three),
 * and CRLF line ends. Blank lines are skipped.
 */
export interface CsvParser {
  push(chunk: string): void;
  end(): void;
}

export function createCsvParser(onRow: (fields: string[]) => void): CsvParser {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Just closed a quoted run; a quote right after it is an escaped quote.
  let justClosed = false;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") onRow(row);
    row = [];
  };

  return {
    push(chunk) {
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk.charCodeAt(i);
        if (inQuotes) {
          if (ch === 34 /* " */) {
            field += chunk.slice(start, i);
            inQuotes = false;
            justClosed = true;
            start = i + 1;
          }
          continue;
        }
        if (ch === 34) {
          field += chunk.slice(start, i);
          if (justClosed) field += '"';
          inQuotes = true;
          justClosed = false;
          start = i + 1;
        } else if (ch === 44 /* , */) {
          row.push(field + chunk.slice(start, i));
          field = "";
          justClosed = false;
          start = i + 1;
        } else if (ch === 10 /* \n */) {
          field += chunk.slice(start, i);
          endRow();
          justClosed = false;
          start = i + 1;
        } else if (ch === 13 /* \r */) {
          field += chunk.slice(start, i);
          start = i + 1;
        } else {
          justClosed = false;
        }
      }
      field += chunk.slice(start);
    },
    end() {
      if (field !== "" || row.length > 0) endRow();
    },
  };
}
