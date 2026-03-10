from PIL import Image, ImageFilter, ImageEnhance
import os

def crystal_clear_upscale(input_path, output_name, scale=16):
    if not os.path.exists(input_path):
        print("Файл не найден")
        return

    # Открываем и увеличиваем сразу в 16 раз для размера ~512x512
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    img = img.resize((width * scale, height * scale), Image.Resampling.LANCZOS)

    # 1. Задираем контраст до предела, чтобы убрать "серый туман" вокруг букв
    contrast = ImageEnhance.Contrast(img)
    img = contrast.enhance(2.0)

    # 2. Прогоняем через фильтр DETAIL несколько раз
    for _ in range(3):
        img = img.filter(ImageFilter.DETAIL)

    # 3. Агрессивная резкость
    sharp = ImageEnhance.Sharpness(img)
    img = sharp.enhance(10.0) # Экстремальное значение для жестких границ

    # 4. Финальный штрих: убираем полупрозрачность на краях (Anti-aliasing cleanup)
    # Это сделает буквы "рублеными", но очень четкими
    pixel_data = img.getdata()
    new_pixels = []
    for p in pixel_data:
        # Если пиксель почти прозрачный — удаляем его совсем
        if p[3] < 128:
            new_pixels.append((p[0], p[1], p[2], 0))
        # Если пиксель плотный — делаем его на 100% непрозрачным
        else:
            new_pixels.append((p[0], p[1], p[2], 255))
    
    img.putdata(new_pixels)

    # Сохраняем
    output_path = os.path.join(os.path.dirname(input_path), output_name)
    img.save(output_path, "PNG")
    print(f"Готово! Текст должен стать жестким: {output_path}")

path = r"C:\Users\Kita1ko\Desktop\fast-rpc\logo\logo.ico"
crystal_clear_upscale(path, "okak.png")