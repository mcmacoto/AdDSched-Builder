(function () {
    const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_TO_INDEX = {
        Monday: 0,
        Tuesday: 1,
        Wednesday: 2,
        Thursday: 3,
        Friday: 4,
        Saturday: 5,
    };

    const NORMALIZED_DAY_MAP = {
        monday: 'Monday',
        tuesday: 'Tuesday',
        wednesday: 'Wednesday',
        thursday: 'Thursday',
        friday: 'Friday',
        saturday: 'Saturday',
    };

    const CANVAS_ID = 'wallpaper-canvas';
    const DEFAULT_RESOLUTION = { width: 1080, height: 2400 };
    const DEFAULT_BACKGROUND = { type: 'solid', color: '#0f172a' };

    let cachedImageSrc = null;
    let cachedImage = null;
    let rendererState = {
        subjects: [],
        background: DEFAULT_BACKGROUND,
        resolution: DEFAULT_RESOLUTION,
    };

    function parseTimeToMinutes(timeValue) {
        if (typeof timeValue !== 'string' || !timeValue.includes(':')) {
            return null;
        }

        const parts = timeValue.split(':');
        const hour = Number(parts[0]);
        const minute = Number(parts[1]);

        if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
            return null;
        }
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            return null;
        }

        return hour * 60 + minute;
    }

    function formatMinutesAsLabel(totalMinutes) {
        let hour = Math.floor(totalMinutes / 60);
        const minute = totalMinutes % 60;
        const suffix = hour >= 12 ? 'PM' : 'AM';

        hour = hour % 12;
        if (hour === 0) {
            hour = 12;
        }

        return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function normalizeDay(dayValue) {
        if (typeof dayValue !== 'string') {
            return null;
        }

        const key = dayValue.trim().toLowerCase();
        return NORMALIZED_DAY_MAP[key] || null;
    }

    function collectSlotTimes(subjects) {
        const starts = [];
        const ends = [];

        if (!Array.isArray(subjects)) {
            return { starts, ends };
        }

        for (const subject of subjects) {
            const slots = Array.isArray(subject.slots) ? subject.slots : [];
            for (const slot of slots) {
                const start = parseTimeToMinutes(slot.start);
                const end = parseTimeToMinutes(slot.end);
                if (start === null || end === null || end <= start) {
                    continue;
                }
                starts.push(start);
                ends.push(end);
            }
        }

        return { starts, ends };
    }

    function computeTimeBounds(subjects) {
        const { starts, ends } = collectSlotTimes(subjects);
        const intervalMinutes = 30;

        if (!starts.length || !ends.length) {
            return {
                min: 7 * 60,
                max: 19 * 60,
            };
        }

        let min = Math.min(...starts);
        let max = Math.max(...ends);

        min = Math.floor(min / intervalMinutes) * intervalMinutes - intervalMinutes;
        max = Math.ceil(max / intervalMinutes) * intervalMinutes + intervalMinutes;

        min = Math.max(0, min);
        max = Math.min(24 * 60, max);

        const minDuration = 4 * 60;
        if (max - min < minDuration) {
            max = min + minDuration;
        }

        return { min, max };
    }

    function roundedRectPath(ctx, x, y, width, height, radius) {
        const r = clamp(radius, 0, Math.min(width, height) / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function hexToRgb(hexColor) {
        if (typeof hexColor !== 'string') {
            return null;
        }

        const cleaned = hexColor.trim().replace('#', '');
        if (cleaned.length !== 3 && cleaned.length !== 6) {
            return null;
        }

        const expanded = cleaned.length === 3
            ? cleaned.split('').map((char) => char + char).join('')
            : cleaned;

        const parsed = Number.parseInt(expanded, 16);
        if (Number.isNaN(parsed)) {
            return null;
        }

        return {
            r: (parsed >> 16) & 255,
            g: (parsed >> 8) & 255,
            b: parsed & 255,
        };
    }

    function getReadableTextColor(backgroundColor) {
        const rgb = hexToRgb(backgroundColor);
        if (!rgb) {
            return '#08131f';
        }

        const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
        return luminance > 0.55 ? '#0b1220' : '#f7fbff';
    }

    function splitWordToFit(ctx, word, maxWidth) {
        if (ctx.measureText(word).width <= maxWidth || maxWidth <= 0) {
            return [word];
        }

        const minGlyphWidth = ctx.measureText('W').width;
        if (maxWidth < minGlyphWidth * 1.15) {
            return [word];
        }

        const chunks = [];
        let remaining = word;

        while (remaining.length > 0) {
            let end = remaining.length;
            while (end > 1 && ctx.measureText(remaining.slice(0, end)).width > maxWidth) {
                end -= 1;
            }

            if (end <= 0) {
                chunks.push(remaining);
                break;
            }

            const chunk = remaining.slice(0, end);
            chunks.push(chunk);
            remaining = remaining.slice(end);
        }

        return chunks;
    }

    function wrapTextLines(ctx, text, maxWidth) {
        const source = String(text || '').trim();
        if (!source) {
            return [];
        }

        const words = source.split(/\s+/);
        const lines = [];
        let currentLine = '';

        for (const rawWord of words) {
            const word = rawWord.trim();
            if (!word) {
                continue;
            }

            if (ctx.measureText(word).width > maxWidth) {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = '';
                }
                lines.push(...splitWordToFit(ctx, word, maxWidth));
                continue;
            }

            const candidate = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxWidth) {
                currentLine = candidate;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    function drawWrappedText(ctx, text, x, y, maxWidth, maxHeight, lineHeight) {
        if (maxHeight <= 0 || maxWidth <= 0) {
            return 0;
        }

        const lines = wrapTextLines(ctx, text, maxWidth);
        let usedHeight = 0;

        for (const line of lines) {
            if (usedHeight + lineHeight > maxHeight) {
                break;
            }

            ctx.fillText(line, x, y + usedHeight, maxWidth);
            usedHeight += lineHeight;
        }

        return usedHeight;
    }

    function computeActiveDays(subjects, hideEmptyDays) {
        if (!hideEmptyDays) {
            return DAY_ORDER;
        }

        const activeSet = new Set();
        const safeSubjects = Array.isArray(subjects) ? subjects : [];

        for (const subject of safeSubjects) {
            const slots = Array.isArray(subject.slots) ? subject.slots : [];
            for (const slot of slots) {
                const days = Array.isArray(slot.days) ? slot.days : [];
                for (const rawDay of days) {
                    const day = normalizeDay(rawDay);
                    if (day) {
                        activeSet.add(day);
                    }
                }
            }
        }

        const filtered = DAY_ORDER.filter((day) => activeSet.has(day));
        return filtered.length > 0 ? filtered : DAY_ORDER;
    }

    function buildLayout(logicalWidth, logicalHeight, bounds, subjects, hideEmptyDays) {
        const activeDays = computeActiveDays(subjects, hideEmptyDays);
        const totalTimeSlots = Math.max(1, Math.round((bounds.max - bounds.min) / 30));

        const isLandscape = logicalWidth >= logicalHeight;
        const baseFontUnitRaw = isLandscape
            ? logicalHeight * 0.015 + logicalWidth * 0.0012
            : logicalWidth * 0.0118 + logicalHeight * 0.002;
        const baseFontUnit = clamp(baseFontUnitRaw, 12, 34);

        const timeColWidth = logicalWidth * (isLandscape ? 0.135 : 0.18);
        const gridWidth = logicalWidth - timeColWidth;
        const colWidth = gridWidth / activeDays.length;

        const titleHeaderHeight = Math.max(baseFontUnit * 2.4, logicalHeight * (isLandscape ? 0.10 : 0.075));
        const dayHeaderHeight = Math.max(baseFontUnit * 1.8, logicalHeight * (isLandscape ? 0.07 : 0.048));
        const fullHeaderHeight = titleHeaderHeight + dayHeaderHeight;
        const dayHeaderTop = titleHeaderHeight;
        const gridTop = fullHeaderHeight;
        const gridHeight = Math.max(1, logicalHeight - gridTop);
        const rowHeight = gridHeight / totalTimeSlots;

        const fontSize = {
            headerTitle: baseFontUnit * 1.55,
            dayLabel: baseFontUnit * 0.95,
            timeLabel: baseFontUnit * 0.82,
            subjectCode: baseFontUnit * 0.9,
            title: baseFontUnit * 0.68,
            room: baseFontUnit * 0.68,
            footerText: baseFontUnit * 0.62,
        };

        const blockPadding = Math.max(4, baseFontUnit * (isLandscape ? 0.52 : 0.56));
        const cornerRadius = Math.max(4, baseFontUnit * 0.85);

        return {
            logicalWidth,
            logicalHeight,
            isLandscape,
            baseFontUnit,
            activeDays,
            totalTimeSlots,
            timeColWidth,
            gridWidth,
            colWidth,
            titleHeaderHeight,
            dayHeaderHeight,
            dayHeaderTop,
            fullHeaderHeight,
            gridTop,
            gridHeight,
            rowHeight,
            fontSize,
            blockPadding,
            cornerRadius,
        };
    }

    function drawBackground(ctx, logicalWidth, logicalHeight, background, redraw) {
        const safeBackground = background || {};
        const type = safeBackground.type || 'solid';

        if (type === 'gradient') {
            const gradient = ctx.createLinearGradient(0, 0, 0, logicalHeight);
            gradient.addColorStop(0, safeBackground.gradientFrom || '#0f172a');
            gradient.addColorStop(1, safeBackground.gradientTo || '#1e293b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, logicalWidth, logicalHeight);
            return;
        }

        if (type === 'image' && safeBackground.imageData) {
            if (cachedImageSrc !== safeBackground.imageData) {
                cachedImageSrc = safeBackground.imageData;
                cachedImage = new Image();
                cachedImage.onload = function () {
                    if (typeof redraw === 'function') {
                        redraw();
                    }
                };
                cachedImage.src = safeBackground.imageData;
            }

            if (cachedImage && cachedImage.complete && cachedImage.naturalWidth > 0) {
                ctx.drawImage(cachedImage, 0, 0, logicalWidth, logicalHeight);
                return;
            }
        }

        ctx.fillStyle = safeBackground.color || '#0f172a';
        ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    function drawAtmosphere(ctx, logicalWidth, logicalHeight) {
        const glow = ctx.createRadialGradient(
            logicalWidth * 0.15,
            logicalHeight * 0.08,
            logicalWidth * 0.01,
            logicalWidth * 0.15,
            logicalHeight * 0.08,
            logicalWidth * 0.8
        );
        glow.addColorStop(0, 'rgba(80, 216, 255, 0.17)');
        glow.addColorStop(1, 'rgba(80, 216, 255, 0)');

        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, logicalWidth, logicalHeight);

        const ember = ctx.createRadialGradient(
            logicalWidth * 0.95,
            logicalHeight * 0.12,
            logicalWidth * 0.01,
            logicalWidth * 0.95,
            logicalHeight * 0.12,
            logicalWidth * 0.65
        );
        ember.addColorStop(0, 'rgba(255, 139, 74, 0.15)');
        ember.addColorStop(1, 'rgba(255, 139, 74, 0)');

        ctx.fillStyle = ember;
        ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    }

    function drawHeader(ctx, layout, title) {
        ctx.save();
        ctx.fillStyle = 'rgba(248, 252, 255, 0.95)';
        ctx.font = `800 ${layout.fontSize.headerTitle}px Bricolage Grotesque`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const displayTitle = (title && String(title).trim()) ? String(title).trim() : 'CLASS SCHEDULE';
        ctx.fillText(displayTitle.toUpperCase(), layout.logicalWidth / 2, layout.titleHeaderHeight * 0.52);
        ctx.restore();
    }

    function drawFooter(ctx, layout) {
        ctx.save();
        ctx.fillStyle = 'rgba(212, 231, 247, 0.8)';
        ctx.font = `500 ${layout.fontSize.footerText}px Manrope`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Made by AdDSched', layout.logicalWidth / 2, layout.logicalHeight - layout.blockPadding * 0.25);
        ctx.restore();
    }

    function drawGrid(ctx, layout, bounds) {
        const minuteStep = 30;
        const majorLineWidth = Math.max(1, (layout.logicalWidth + layout.logicalHeight) * 0.00045);
        const minorLineWidth = Math.max(0.8, (layout.logicalWidth + layout.logicalHeight) * 0.00033);
        const gridLeft = layout.timeColWidth;
        const gridTop = layout.gridTop;
        const gridRight = layout.logicalWidth;
        const gridBottom = layout.logicalHeight;

        ctx.save();
        ctx.strokeStyle = 'rgba(216, 238, 255, 0.18)';
        ctx.lineWidth = minorLineWidth;
        ctx.beginPath();
        ctx.moveTo(0, layout.dayHeaderTop);
        ctx.lineTo(layout.logicalWidth, layout.dayHeaderTop);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, gridTop);
        ctx.lineTo(layout.logicalWidth, gridTop);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(layout.timeColWidth, layout.dayHeaderTop);
        ctx.lineTo(layout.timeColWidth, gridBottom);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(216, 238, 255, 0.12)';
        ctx.lineWidth = majorLineWidth;
        roundedRectPath(ctx, gridLeft, gridTop, layout.gridWidth, layout.gridHeight, layout.cornerRadius);
        ctx.stroke();

        for (let column = 0; column <= layout.activeDays.length; column += 1) {
            const x = gridLeft + column * layout.colWidth;
            ctx.beginPath();
            ctx.moveTo(x, gridTop);
            ctx.lineTo(x, gridBottom);
            ctx.strokeStyle = column === 0 || column === layout.activeDays.length
                ? 'rgba(216, 238, 255, 0.18)'
                : 'rgba(216, 238, 255, 0.09)';
            ctx.lineWidth = minorLineWidth;
            ctx.stroke();
        }

        for (let slotIndex = 0; slotIndex <= layout.totalTimeSlots; slotIndex += 1) {
            const y = gridTop + slotIndex * layout.rowHeight;
            const majorLine = slotIndex % 2 === 0;

            ctx.beginPath();
            ctx.moveTo(gridLeft, y);
            ctx.lineTo(gridRight, y);
            ctx.strokeStyle = majorLine
                ? 'rgba(216, 238, 255, 0.18)'
                : 'rgba(216, 238, 255, 0.08)';
            ctx.lineWidth = majorLine ? majorLineWidth : minorLineWidth;
            ctx.stroke();

            if (majorLine && slotIndex < layout.totalTimeSlots) {
                const current = bounds.min + slotIndex * minuteStep;
                ctx.fillStyle = 'rgba(234, 244, 255, 0.86)';
                ctx.font = `${layout.fontSize.timeLabel}px Manrope`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatMinutesAsLabel(current), layout.timeColWidth - layout.blockPadding * 0.35, y);
            }
        }

        ctx.fillStyle = 'rgba(234, 244, 255, 0.96)';
        ctx.font = `700 ${layout.fontSize.dayLabel}px Bricolage Grotesque`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        for (let index = 0; index < layout.activeDays.length; index += 1) {
            const labelX = layout.timeColWidth + (index + 0.5) * layout.colWidth;
            ctx.fillText(layout.activeDays[index].slice(0, 3), labelX, layout.dayHeaderTop + layout.dayHeaderHeight * 0.54);
        }

        ctx.restore();
    }

    function drawSlotBlocks(ctx, layout, bounds, subjects) {
        const totalMinutes = bounds.max - bounds.min;
        const safeSubjects = Array.isArray(subjects) ? subjects : [];

        for (const subject of safeSubjects) {
            const color = subject.color || '#0ea5e9';
            const textColor = getReadableTextColor(color);
            const subjectTitle = (subject.title || subject.subject_no || 'Untitled Subject').trim();
            const subjectCode = (subject.subject_no || '').trim();
            const slots = Array.isArray(subject.slots) ? subject.slots : [];

            for (const slot of slots) {
                const start = parseTimeToMinutes(slot.start);
                const end = parseTimeToMinutes(slot.end);
                if (start === null || end === null || end <= start) {
                    continue;
                }

                const room = (slot.room || '').trim();
                const days = Array.isArray(slot.days) ? slot.days : [];

                for (const rawDay of days) {
                    const day = normalizeDay(rawDay);
                    const dayIndex = day ? layout.activeDays.indexOf(day) : -1;
                    if (dayIndex === -1) {
                        continue;
                    }

                    const blockX = layout.timeColWidth + dayIndex * layout.colWidth + layout.blockPadding;
                    const blockWidth = layout.colWidth - layout.blockPadding * 2;
                    const blockY = layout.gridTop + ((start - bounds.min) / totalMinutes) * layout.gridHeight + layout.blockPadding * 0.25;
                    const blockHeight = ((end - start) / totalMinutes) * layout.gridHeight - layout.blockPadding * 0.5;

                    if (blockHeight <= layout.blockPadding) {
                        continue;
                    }

                    roundedRectPath(ctx, blockX, blockY, blockWidth, blockHeight, layout.cornerRadius);
                    ctx.fillStyle = color;
                    ctx.fill();

                    ctx.save();
                    roundedRectPath(ctx, blockX, blockY, blockWidth, blockHeight, layout.cornerRadius);
                    ctx.clip();

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                    ctx.fillRect(blockX, blockY, blockWidth, blockHeight * 0.44);

                    ctx.fillStyle = textColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';

                    const textX = blockX + layout.blockPadding * 0.5;
                    const maxTextWidth = blockWidth - layout.blockPadding;
                    const contentTop = blockY + layout.blockPadding * 0.45;
                    const contentBottom = blockY + blockHeight - layout.blockPadding * 0.35;
                    let textY = contentTop;
                    const groupGap = layout.blockPadding * 0.25;

                    const titleLineHeight = layout.fontSize.title * 1.15;
                    ctx.font = `700 ${layout.fontSize.title}px Bricolage Grotesque`;
                    const titleAvailableHeight = Math.max(0, contentBottom - textY);
                    const usedTitleHeight = drawWrappedText(
                        ctx,
                        subjectTitle,
                        textX,
                        textY,
                        maxTextWidth,
                        titleAvailableHeight,
                        titleLineHeight
                    );
                    textY += usedTitleHeight;

                    if (usedTitleHeight > 0) {
                        textY += groupGap;
                    }

                    if (subjectCode && textY < contentBottom) {
                        ctx.globalAlpha = 0.85;
                        ctx.font = `700 ${layout.fontSize.subjectCode}px Manrope`;
                        const codeLineHeight = layout.fontSize.subjectCode * 1.12;
                        const codeAvailableHeight = Math.max(0, contentBottom - textY);
                        const usedCodeHeight = drawWrappedText(
                            ctx,
                            subjectCode,
                            textX,
                            textY,
                            maxTextWidth,
                            codeAvailableHeight,
                            codeLineHeight
                        );
                        textY += usedCodeHeight;
                        if (usedCodeHeight > 0) {
                            textY += groupGap;
                        }
                    }

                    if (room && textY < contentBottom) {
                        ctx.globalAlpha = 0.8;
                        ctx.font = `600 ${layout.fontSize.room}px Manrope`;
                        const roomLineHeight = layout.fontSize.room * 1.1;
                        const roomAvailableHeight = Math.max(0, contentBottom - textY);
                        drawWrappedText(
                            ctx,
                            room,
                            textX,
                            textY,
                            maxTextWidth,
                            roomAvailableHeight,
                            roomLineHeight
                        );
                    }

                    ctx.globalAlpha = 1;
                    ctx.restore();
                }
            }
        }
    }

    function renderWallpaperScene(ctx, logicalWidth, logicalHeight, subjects, background, redraw, title, hideEmptyDays) {
        drawBackground(ctx, logicalWidth, logicalHeight, background, redraw);
        if (!background || background.atmosphere !== false) {
            drawAtmosphere(ctx, logicalWidth, logicalHeight);
        }

        const bounds = computeTimeBounds(subjects);
        const layout = buildLayout(logicalWidth, logicalHeight, bounds, subjects, hideEmptyDays);

        drawHeader(ctx, layout, title);
        drawGrid(ctx, layout, bounds);
        drawSlotBlocks(ctx, layout, bounds, subjects);
        drawFooter(ctx, layout);
    }

    function configurePreviewContext(canvas, logicalWidth, logicalHeight) {
        const dpr = window.devicePixelRatio || 1;

        canvas.width = logicalWidth * dpr;
        canvas.height = logicalHeight * dpr;

        const parentWidth = canvas.parentElement ? Math.max(1, canvas.parentElement.clientWidth - 8) : logicalWidth;
        const viewportHeight = window.innerHeight || logicalHeight;
        const maxPreviewHeight = Math.max(260, Math.floor(viewportHeight * 0.62));
        const fitScale = Math.min(parentWidth / logicalWidth, maxPreviewHeight / logicalHeight, 1);
        const displayWidth = Math.max(140, Math.floor(logicalWidth * fitScale));
        const displayHeight = Math.max(140, Math.floor(logicalHeight * fitScale));

        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = '100%';
        canvas.style.aspectRatio = `${logicalWidth} / ${logicalHeight}`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        return ctx;
    }

    function drawWallpaper(subjects, background, resolution, title, hideEmptyDays) {
        const canvas = document.getElementById(CANVAS_ID);
        if (!canvas) {
            return;
        }

        const width = Number(resolution && resolution.width) || DEFAULT_RESOLUTION.width;
        const height = Number(resolution && resolution.height) || DEFAULT_RESOLUTION.height;
        const safeSubjects = Array.isArray(subjects) ? subjects : [];
        const safeBackground = background || DEFAULT_BACKGROUND;

        rendererState = {
            subjects: safeSubjects,
            background: safeBackground,
            resolution: { width, height },
            title: title || 'CLASS SCHEDULE',
            hideEmptyDays: !!hideEmptyDays,
        };

        const ctx = configurePreviewContext(canvas, width, height);
        if (!ctx) {
            return;
        }

        renderWallpaperScene(ctx, width, height, safeSubjects, safeBackground, function () {
            drawWallpaper(rendererState.subjects, rendererState.background, rendererState.resolution, rendererState.title, rendererState.hideEmptyDays);
        }, rendererState.title, !!hideEmptyDays);
    }

    function renderToCanvas(canvas, subjects, background, resolution, title, hideEmptyDays) {
        if (!canvas) return;
        const width = Number(resolution && resolution.width) || DEFAULT_RESOLUTION.width;
        const height = Number(resolution && resolution.height) || DEFAULT_RESOLUTION.height;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderWallpaperScene(ctx, width, height, subjects || [], background || DEFAULT_BACKGROUND, null, title || 'CLASS SCHEDULE', !!hideEmptyDays);
    }

    function downloadWallpaper(filename) {
        const width = Number(rendererState.resolution && rendererState.resolution.width) || DEFAULT_RESOLUTION.width;
        const height = Number(rendererState.resolution && rendererState.resolution.height) || DEFAULT_RESOLUTION.height;

        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;

        const ctx = offscreen.getContext('2d');
        if (!ctx) {
            return;
        }

        renderWallpaperScene(
            ctx,
            width,
            height,
            rendererState.subjects || [],
            rendererState.background || DEFAULT_BACKGROUND,
            null,
            rendererState.title || 'CLASS SCHEDULE',
            !!rendererState.hideEmptyDays
        );

        const link = document.createElement('a');
        link.download = filename || 'addsched-wallpaper.png';
        link.href = offscreen.toDataURL('image/png');
        link.click();
    }

    window.AdDSchedCanvas = {
        drawWallpaper,
        renderToCanvas,
        downloadWallpaper,
    };

    window.drawWallpaper = drawWallpaper;
})();
