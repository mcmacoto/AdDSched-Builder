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
    let cachedImageSrc = null;
    let cachedImage = null;

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

        if (!starts.length || !ends.length) {
            return {
                min: 7 * 60,
                max: 19 * 60,
            };
        }

        let min = Math.min(...starts);
        let max = Math.max(...ends);

        min = Math.floor(min / 30) * 30;
        max = Math.ceil(max / 30) * 30;

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

    function drawBackground(ctx, canvas, background, redraw) {
        const safeBackground = background || {};
        const type = safeBackground.type || 'solid';

        if (type === 'gradient') {
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, safeBackground.gradientFrom || '#0f172a');
            gradient.addColorStop(1, safeBackground.gradientTo || '#1e293b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
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
                ctx.drawImage(cachedImage, 0, 0, canvas.width, canvas.height);
                return;
            }
        }

        ctx.fillStyle = safeBackground.color || '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawAtmosphere(ctx, canvas) {
        const glow = ctx.createRadialGradient(
            canvas.width * 0.15,
            canvas.height * 0.08,
            10,
            canvas.width * 0.15,
            canvas.height * 0.08,
            canvas.width * 0.8
        );
        glow.addColorStop(0, 'rgba(80, 216, 255, 0.17)');
        glow.addColorStop(1, 'rgba(80, 216, 255, 0)');

        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const ember = ctx.createRadialGradient(
            canvas.width * 0.95,
            canvas.height * 0.12,
            10,
            canvas.width * 0.95,
            canvas.height * 0.12,
            canvas.width * 0.65
        );
        ember.addColorStop(0, 'rgba(255, 139, 74, 0.15)');
        ember.addColorStop(1, 'rgba(255, 139, 74, 0)');

        ctx.fillStyle = ember;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawGrid(ctx, layout, bounds) {
        const totalMinutes = bounds.max - bounds.min;
        const minuteStep = 30;

        ctx.save();
        ctx.strokeStyle = 'rgba(216, 238, 255, 0.12)';
        ctx.lineWidth = Math.max(1, layout.scale * 1.3);
        roundedRectPath(ctx, layout.left, layout.top, layout.width, layout.height, 22 * layout.scale);
        ctx.stroke();

        for (let column = 0; column <= DAY_ORDER.length; column += 1) {
            const x = layout.left + column * layout.columnWidth;
            ctx.beginPath();
            ctx.moveTo(x, layout.top);
            ctx.lineTo(x, layout.top + layout.height);
            ctx.strokeStyle = column === 0 || column === DAY_ORDER.length
                ? 'rgba(216, 238, 255, 0.18)'
                : 'rgba(216, 238, 255, 0.09)';
            ctx.lineWidth = Math.max(1, layout.scale);
            ctx.stroke();
        }

        for (let current = bounds.min; current <= bounds.max; current += minuteStep) {
            const ratio = (current - bounds.min) / totalMinutes;
            const y = layout.top + ratio * layout.height;
            const majorLine = current % 60 === 0;

            ctx.beginPath();
            ctx.moveTo(layout.left, y);
            ctx.lineTo(layout.left + layout.width, y);
            ctx.strokeStyle = majorLine
                ? 'rgba(216, 238, 255, 0.18)'
                : 'rgba(216, 238, 255, 0.08)';
            ctx.lineWidth = majorLine ? Math.max(1.2, layout.scale * 1.2) : Math.max(0.8, layout.scale * 0.9);
            ctx.stroke();

            if (majorLine) {
                ctx.fillStyle = 'rgba(234, 244, 255, 0.86)';
                ctx.font = `${Math.max(14, 13 * layout.scale)}px Manrope`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(formatMinutesAsLabel(current), layout.left - 14 * layout.scale, y);
            }
        }

        ctx.fillStyle = 'rgba(234, 244, 255, 0.96)';
        ctx.font = `700 ${Math.max(15, 16 * layout.scale)}px Bricolage Grotesque`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        for (let index = 0; index < DAY_ORDER.length; index += 1) {
            const labelX = layout.left + (index + 0.5) * layout.columnWidth;
            ctx.fillText(DAY_ORDER[index].slice(0, 3), labelX, layout.top - 24 * layout.scale);
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
                const metaParts = [];
                if (subjectCode) {
                    metaParts.push(subjectCode);
                }
                if (room) {
                    metaParts.push(room);
                }
                const metaLine = metaParts.join(' | ');
                const days = Array.isArray(slot.days) ? slot.days : [];

                for (const rawDay of days) {
                    const day = normalizeDay(rawDay);
                    const dayIndex = day ? DAY_TO_INDEX[day] : undefined;
                    if (dayIndex === undefined) {
                        continue;
                    }

                    const blockX = layout.left + dayIndex * layout.columnWidth + layout.blockInset;
                    const blockWidth = layout.columnWidth - layout.blockInset * 2;
                    const blockY = layout.top + ((start - bounds.min) / totalMinutes) * layout.height + layout.blockInset;
                    const blockHeight = ((end - start) / totalMinutes) * layout.height - layout.blockInset * 1.5;

                    if (blockHeight < 8 * layout.scale) {
                        continue;
                    }

                    roundedRectPath(ctx, blockX, blockY, blockWidth, blockHeight, 12 * layout.scale);
                    ctx.fillStyle = color;
                    ctx.fill();

                    ctx.save();
                    roundedRectPath(ctx, blockX, blockY, blockWidth, blockHeight, 12 * layout.scale);
                    ctx.clip();

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                    ctx.fillRect(blockX, blockY, blockWidth, Math.max(12, blockHeight * 0.44));

                    ctx.fillStyle = textColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';

                    const titleSize = Math.max(12, 13 * layout.scale);
                    const metaSize = Math.max(10, 11 * layout.scale);
                    const paddingX = 10 * layout.scale;
                    const paddingY = 8 * layout.scale;

                    ctx.font = `700 ${titleSize}px Bricolage Grotesque`;
                    ctx.fillText(subjectTitle, blockX + paddingX, blockY + paddingY, blockWidth - paddingX * 2);

                    if (metaLine && blockHeight > metaSize * 2.4) {
                        ctx.globalAlpha = 0.85;
                        ctx.font = `600 ${metaSize}px Manrope`;
                        ctx.fillText(
                            metaLine,
                            blockX + paddingX,
                            blockY + paddingY + titleSize + 6 * layout.scale,
                            blockWidth - paddingX * 2
                        );
                        ctx.globalAlpha = 1;
                    }

                    ctx.restore();
                }
            }
        }
    }

    function drawHeader(ctx, canvas) {
        ctx.save();
        ctx.fillStyle = 'rgba(248, 252, 255, 0.95)';
        ctx.font = `800 ${Math.max(24, canvas.width * 0.035)}px Bricolage Grotesque`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('CLASS SCHEDULE', canvas.width * 0.055, canvas.height * 0.032);
        ctx.restore();
    }

    function drawFooter(ctx, canvas) {
        ctx.save();
        ctx.fillStyle = 'rgba(212, 231, 247, 0.8)';
        ctx.font = `500 ${Math.max(10, canvas.width * 0.011)}px Manrope`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Made by AdDSched', canvas.width / 2, canvas.height * 0.985);
        ctx.restore();
    }

    function drawWallpaper(subjects, background, resolution) {
        const canvas = document.getElementById(CANVAS_ID);
        if (!canvas) {
            return;
        }

        const width = Number(resolution && resolution.width) || 1080;
        const height = Number(resolution && resolution.height) || 2400;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        drawBackground(ctx, canvas, background, function () {
            drawWallpaper(subjects, background, resolution);
        });
        drawAtmosphere(ctx, canvas);
        drawHeader(ctx, canvas);

        const scale = canvas.width / 1080;
        const layout = {
            scale,
            left: canvas.width * 0.09,
            top: canvas.height * 0.095,
            width: canvas.width * 0.86,
            height: canvas.height * 0.84,
            columnWidth: (canvas.width * 0.86) / DAY_ORDER.length,
            blockInset: Math.max(4, 6 * scale),
        };

        const bounds = computeTimeBounds(subjects);
        drawGrid(ctx, layout, bounds);
        drawSlotBlocks(ctx, layout, bounds, subjects);
        drawFooter(ctx, canvas);
    }

    function downloadWallpaper(filename) {
        const canvas = document.getElementById(CANVAS_ID);
        if (!canvas) {
            return;
        }

        const link = document.createElement('a');
        link.download = filename || 'addsched-wallpaper.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    window.AdDSchedCanvas = {
        drawWallpaper,
        downloadWallpaper,
    };

    window.drawWallpaper = drawWallpaper;
})();
