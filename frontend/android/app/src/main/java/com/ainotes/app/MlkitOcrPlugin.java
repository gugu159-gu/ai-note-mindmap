package com.ainotes.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.io.File;

/**
 * 本机离线 OCR 插件（Google ML Kit 文字识别 · 中文模型）。
 *
 * 性能设计：
 * - 识别器单例（首次创建会加载模型，之后复用）
 * - 提供 warmup() 供前端在启动时预热：不仅建客户端，还会用一张带真字的哑图跑一次真实推理，
 *   把 ML Kit 懒加载的模型图初始化提前到启动瞬间（详见 warmup() 注释）
 * - 输出分段耗时日志（解码 / 识别），便于量化优化效果
 *
 * 前端用法：Capacitor.Plugins.MlkitOcr.recognize({ image: 'data:image/jpeg;base64,...' })
 * 返回：{ text, blocks, decodeMs, totalMs }
 */
@CapacitorPlugin(name = "MlkitOcr")
public class MlkitOcrPlugin extends Plugin {

    private static final String TAG = "MlkitOcr";
    private TextRecognizer recognizer;

    private TextRecognizer getRecognizer() {
        if (recognizer == null) {
            long t0 = System.currentTimeMillis();
            recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
            Log.d(TAG, "recognizer created in " + (System.currentTimeMillis() - t0) + "ms");
        }
        return recognizer;
    }

    /**
     * 预热用哑图：**必须画上真实汉字**。
     *
     * ML Kit 的文字识别是两段式（文字检测 → 字符识别），两段的模型图各自懒加载：
     * 一张空白图只会让检测器初始化，字符识别模型依旧是冷的 —— 那部分开销还是会
     * 落到用户的第一张照片上。所以这里画一行真字，确保两段都被真正跑过一次。
     */
    private Bitmap makeWarmupBitmap() {
        int w = 360;
        int h = 140;
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextSize(56f);
        paint.setTypeface(Typeface.DEFAULT_BOLD);
        canvas.drawText("预热汉字", 20f, 90f, paint);
        return bmp;
    }

    /**
     * 预热点：应用启动时调用，提前把模型载入内存。
     *
     * 注意 getRecognizer() 里的 getClient() **只创建客户端对象，不做任何推理**；
     * ML Kit 的模型图初始化发生在首次 process() 调用时。实测（Redmi K80 / Android 16）：
     * 只建客户端的预热之后，用户第一张照片仍要 263ms（推理 228ms），
     * 而第二张起只要 ~70ms（推理 ~55ms）—— 那 ~190ms 的一次性开销被白记在第一张照片上。
     * 因此这里补一次真实推理，把图初始化提前到启动瞬间。
     */
    @PluginMethod
    public void warmup(PluginCall call) {
        final long t0 = System.currentTimeMillis();
        final TextRecognizer rec = getRecognizer();
        final long tCreated = System.currentTimeMillis();

        Bitmap probe;
        try {
            probe = makeWarmupBitmap();
        } catch (Throwable e) {
            // 造不出哑图时退回「只建客户端」，不因此让预热失败
            Log.w(TAG, "warmup probe bitmap failed: " + e.getMessage());
            Log.d(TAG, "warmup done in " + (tCreated - t0) + "ms (create=" + (tCreated - t0)
                    + "ms graphInit=skipped)");
            JSObject ret = new JSObject();
            ret.put("ready", true);
            ret.put("createMs", tCreated - t0);
            call.resolve(ret);
            return;
        }

        // 用 addOnCompleteListener：预热失败（成功与否）都必须 resolve，绝不能卡住前端
        rec.process(InputImage.fromBitmap(probe, 0))
            .addOnCompleteListener(task -> {
                probe.recycle();
                long tDone = System.currentTimeMillis();
                String text = "";
                if (task.isSuccessful() && task.getResult() != null) {
                    text = task.getResult().getText();
                }
                Log.d(TAG, "warmup done in " + (tDone - t0) + "ms (create=" + (tCreated - t0)
                        + "ms graphInit=" + (tDone - tCreated) + "ms textLen=" + text.length() + ")");
                JSObject ret = new JSObject();
                ret.put("ready", true);
                ret.put("createMs", tCreated - t0);
                ret.put("graphInitMs", tDone - tCreated);
                ret.put("warmupTextLen", text.length());
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String source = call.getString("image");
        if (source == null || source.isEmpty()) {
            call.reject("缺少参数 image");
            return;
        }

        final long tStart = System.currentTimeMillis();
        try {
            InputImage image = toInputImage(source);
            final long tDecoded = System.currentTimeMillis();
            getRecognizer()
                .process(image)
                .addOnSuccessListener(result -> {
                    long tDone = System.currentTimeMillis();
                    Log.d(TAG, "decode=" + (tDecoded - tStart) + "ms infer=" + (tDone - tDecoded)
                            + "ms total=" + (tDone - tStart) + "ms blocks=" + result.getTextBlocks().size());
                    JSObject ret = new JSObject();
                    ret.put("text", result.getText());
                    ret.put("blocks", result.getTextBlocks().size());
                    ret.put("decodeMs", tDecoded - tStart);
                    ret.put("totalMs", tDone - tStart);
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "recognize failed: " + e.getMessage(), e);
                    call.reject("ML Kit 识别失败：" + e.getMessage(), e);
                });
        } catch (Exception e) {
            Log.e(TAG, "exception: " + e.getMessage(), e);
            call.reject("ML Kit 调用异常：" + e.getMessage(), e);
        }
    }

    /** 支持 dataURL（base64）与本地文件路径两种入参 */
    private InputImage toInputImage(String source) throws Exception {
        if (source.startsWith("data:")) {
            int comma = source.indexOf(',');
            String base64 = comma >= 0 ? source.substring(comma + 1) : source;
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) throw new IllegalArgumentException("图片解码失败");
            return InputImage.fromBitmap(bitmap, 0);
        }
        return InputImage.fromFilePath(getContext(), Uri.fromFile(new File(source)));
    }
}
