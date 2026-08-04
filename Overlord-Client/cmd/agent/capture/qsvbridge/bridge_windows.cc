//go:build windows && cgo

#include "bridge_windows.h"
#include <windows.h>
#include <d3d10.h>
#include <d3d11.h>
#include <dxgi.h>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include <cstdio>
#define ONEVPL_EXPERIMENTAL
#include "../../../../third_party/onevpl/include/vpl/mfxdispatcher.h"
#include "../../../../third_party/onevpl/include/vpl/mfxvideo.h"

namespace {

template<class T> void release(T*& value) { if (value) { value->Release(); value = nullptr; } }
void set_error(char* dst, int cap, const std::string& text) {
    if (!dst || cap <= 0) return;
    size_t n = std::min(text.size(), static_cast<size_t>(cap - 1));
    std::memcpy(dst, text.data(), n); dst[n] = 0;
}
std::string status_error(const char* stage, mfxStatus sts) {
    return std::string(stage) + " failed (mfxStatus=" + std::to_string(static_cast<int>(sts)) + ")";
}
std::string hr_error(const char* stage, HRESULT hr) {
    return std::string(stage) + " failed (HRESULT=0x" + [] (HRESULT v) {
        char b[16]; std::snprintf(b, sizeof(b), "%08lx", static_cast<unsigned long>(v)); return std::string(b);
    }(hr) + ")";
}

struct VPLFunctions {
    HMODULE dll = nullptr;
    decltype(&MFXLoad) Load = nullptr;
    decltype(&MFXUnload) Unload = nullptr;
    decltype(&MFXCreateConfig) CreateConfig = nullptr;
    decltype(&MFXSetConfigFilterProperty) SetConfig = nullptr;
    decltype(&MFXCreateSession) CreateSession = nullptr;
    decltype(&MFXClose) Close = nullptr;
    decltype(&MFXVideoCORE_SetHandle) SetHandle = nullptr;
    decltype(&MFXVideoCORE_GetHandle) GetHandle = nullptr;
    decltype(&MFXVideoENCODE_Init) EncodeInit = nullptr;
    decltype(&MFXVideoENCODE_Close) EncodeClose = nullptr;
    decltype(&MFXVideoENCODE_EncodeFrameAsync) EncodeFrame = nullptr;
    decltype(&MFXVideoCORE_SyncOperation) Sync = nullptr;

    bool open(std::string& error) {
        dll = LoadLibraryW(L"libvpl.dll");
        if (!dll) dll = LoadLibraryW(L"vpl.dll");
        if (!dll) { error = "Intel oneVPL dispatcher (libvpl.dll) is not installed"; return false; }
#define LOAD_VPL(member, symbol) member = reinterpret_cast<decltype(member)>(GetProcAddress(dll, symbol)); if (!member) { error = std::string("oneVPL dispatcher is missing ") + symbol; close(); return false; }
        LOAD_VPL(Load, "MFXLoad"); LOAD_VPL(Unload, "MFXUnload");
        LOAD_VPL(CreateConfig, "MFXCreateConfig"); LOAD_VPL(SetConfig, "MFXSetConfigFilterProperty");
        LOAD_VPL(CreateSession, "MFXCreateSession"); LOAD_VPL(Close, "MFXClose");
        LOAD_VPL(SetHandle, "MFXVideoCORE_SetHandle"); LOAD_VPL(GetHandle, "MFXVideoCORE_GetHandle");
        LOAD_VPL(EncodeInit, "MFXVideoENCODE_Init"); LOAD_VPL(EncodeClose, "MFXVideoENCODE_Close");
        LOAD_VPL(EncodeFrame, "MFXVideoENCODE_EncodeFrameAsync"); LOAD_VPL(Sync, "MFXVideoCORE_SyncOperation");
#undef LOAD_VPL
        return true;
    }
    void close() { if (dll) FreeLibrary(dll); dll = nullptr; }
};

struct QSVEncoder {
    VPLFunctions api;
    mfxLoader loader = nullptr;
    mfxSession session = nullptr;
    mfxMemoryInterface* memory = nullptr;
    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    ID3D11VideoDevice* videoDevice = nullptr;
    ID3D11VideoContext* videoContext = nullptr;
    ID3D11VideoProcessorEnumerator* processorEnum = nullptr;
    ID3D11VideoProcessor* processor = nullptr;
    ID3D11Texture2D* nv12 = nullptr;
    ID3D11VideoProcessorOutputView* outputView = nullptr;
    int inputWidth = 0, inputHeight = 0, width = 0, height = 0;
    std::vector<uint8_t> bitstream;
};

void destroy(QSVEncoder* s) {
    if (!s) return;
    if (s->session) { s->api.EncodeClose(s->session); s->api.Close(s->session); }
    if (s->loader) s->api.Unload(s->loader);
    release(s->outputView); release(s->nv12); release(s->processor); release(s->processorEnum);
    release(s->videoContext); release(s->videoDevice); release(s->context); release(s->device);
    s->api.close(); delete s;
}

bool config_u32(QSVEncoder* s, const char* name, mfxU32 value, std::string& error) {
    mfxConfig cfg = s->api.CreateConfig(s->loader);
    if (!cfg) { error = "MFXCreateConfig failed"; return false; }
    mfxVariant v = {}; v.Type = MFX_VARIANT_TYPE_U32; v.Data.U32 = value;
    mfxStatus sts = s->api.SetConfig(cfg, reinterpret_cast<const mfxU8*>(name), v);
    if (sts != MFX_ERR_NONE) { error = status_error(name, sts); return false; }
    return true;
}

bool init_session(QSVEncoder* s, std::string& error) {
    s->loader = s->api.Load();
    if (!s->loader) { error = "MFXLoad found no oneVPL dispatcher"; return false; }
    if (!config_u32(s, "mfxImplDescription.Impl", MFX_IMPL_TYPE_HARDWARE, error) ||
        !config_u32(s, "mfxImplDescription.VendorID", 0x8086, error) ||
        !config_u32(s, "mfxImplDescription.mfxEncoderDescription.encoder.CodecID", MFX_CODEC_AVC, error) ||
        !config_u32(s, "mfxImplDescription.AccelerationMode", MFX_ACCEL_MODE_VIA_D3D11, error) ||
        !config_u32(s, "mfxImplDescription.ApiVersion.Version", (2u << 16) | 10u, error)) return false;
    mfxStatus sts = s->api.CreateSession(s->loader, 0, &s->session);
    if (sts != MFX_ERR_NONE || !s->session) { error = status_error("MFXCreateSession (Intel D3D11 H.264)", sts); return false; }
    return true;
}

bool validate_intel_device(QSVEncoder* s, std::string& error) {
    IDXGIDevice* dxgiDevice = nullptr;
    HRESULT hr = s->device->QueryInterface(__uuidof(IDXGIDevice), reinterpret_cast<void**>(&dxgiDevice));
    if (FAILED(hr)) { error = hr_error("IDXGIDevice", hr); return false; }
    IDXGIAdapter* adapter = nullptr;
    hr = dxgiDevice->GetAdapter(&adapter);
    dxgiDevice->Release();
    if (FAILED(hr) || !adapter) { error = hr_error("IDXGIDevice::GetAdapter", hr); return false; }
    DXGI_ADAPTER_DESC desc = {};
    hr = adapter->GetDesc(&desc);
    adapter->Release();
    if (FAILED(hr)) { error = hr_error("IDXGIAdapter::GetDesc", hr); return false; }
    if (desc.VendorId != 0x8086) {
        error = "Intel Quick Sync requires the selected display to use an Intel adapter";
        return false;
    }
    return true;
}

bool protect_device_context(QSVEncoder* s, std::string& error) {
    ID3D10Multithread* multithread = nullptr;
    HRESULT hr = s->context->QueryInterface(__uuidof(ID3D10Multithread), reinterpret_cast<void**>(&multithread));
    if (FAILED(hr)) { error = hr_error("ID3D10Multithread", hr); return false; }
    multithread->SetMultithreadProtected(TRUE);
    multithread->Release();
    return true;
}

bool init_video_processor(QSVEncoder* s, std::string& error) {
    HRESULT hr = s->device->QueryInterface(__uuidof(ID3D11VideoDevice), reinterpret_cast<void**>(&s->videoDevice));
    if (FAILED(hr)) { error = hr_error("ID3D11VideoDevice", hr); return false; }
    hr = s->context->QueryInterface(__uuidof(ID3D11VideoContext), reinterpret_cast<void**>(&s->videoContext));
    if (FAILED(hr)) { error = hr_error("ID3D11VideoContext", hr); return false; }
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC desc = {};
    desc.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    desc.InputFrameRate = {60, 1}; desc.OutputFrameRate = {60, 1};
    desc.InputWidth = s->inputWidth; desc.InputHeight = s->inputHeight;
    desc.OutputWidth = s->width; desc.OutputHeight = s->height;
    desc.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
    hr = s->videoDevice->CreateVideoProcessorEnumerator(&desc, &s->processorEnum);
    if (FAILED(hr)) { error = hr_error("CreateVideoProcessorEnumerator", hr); return false; }
    hr = s->videoDevice->CreateVideoProcessor(s->processorEnum, 0, &s->processor);
    if (FAILED(hr)) { error = hr_error("CreateVideoProcessor", hr); return false; }
    D3D11_TEXTURE2D_DESC td = {};
    td.Width = (s->width + 15) & ~15; td.Height = (s->height + 15) & ~15;
    td.MipLevels = 1; td.ArraySize = 1; td.Format = DXGI_FORMAT_NV12; td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_DEFAULT; td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    td.MiscFlags = D3D11_RESOURCE_MISC_SHARED;
    hr = s->device->CreateTexture2D(&td, nullptr, &s->nv12);
    if (FAILED(hr)) { error = hr_error("CreateTexture2D NV12", hr); return false; }
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC ov = {}; ov.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    hr = s->videoDevice->CreateVideoProcessorOutputView(s->nv12, s->processorEnum, &ov, &s->outputView);
    if (FAILED(hr)) { error = hr_error("CreateVideoProcessorOutputView", hr); return false; }
    RECT src = {0, 0, s->inputWidth, s->inputHeight}, dst = {0, 0, s->width, s->height};
    s->videoContext->VideoProcessorSetStreamSourceRect(s->processor, 0, TRUE, &src);
    s->videoContext->VideoProcessorSetStreamDestRect(s->processor, 0, TRUE, &dst);
    s->videoContext->VideoProcessorSetOutputTargetRect(s->processor, TRUE, &dst);
    return true;
}

bool convert(QSVEncoder* s, ID3D11Texture2D* texture, std::string& error) {
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC iv = {};
    iv.FourCC = 0; iv.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D; iv.Texture2D.MipSlice = 0;
    ID3D11VideoProcessorInputView* input = nullptr;
    HRESULT hr = s->videoDevice->CreateVideoProcessorInputView(texture, s->processorEnum, &iv, &input);
    if (FAILED(hr)) { error = hr_error("CreateVideoProcessorInputView", hr); return false; }
    D3D11_VIDEO_PROCESSOR_STREAM stream = {}; stream.Enable = TRUE; stream.pInputSurface = input;
    hr = s->videoContext->VideoProcessorBlt(s->processor, s->outputView, 0, 1, &stream);
    input->Release();
    if (FAILED(hr)) { error = hr_error("VideoProcessorBlt", hr); return false; }
    return true;
}

} // namespace

extern "C" int overlord_qsv_probe(char* error_text, int error_capacity) {
    auto* s = new QSVEncoder(); std::string error;
    bool ok = s->api.open(error) && init_session(s, error);
    if (!ok) set_error(error_text, error_capacity, error);
    destroy(s); return ok ? 1 : 0;
}

extern "C" int overlord_qsv_create(void* device, int input_width, int input_height,
    int width, int height, int fps, uint32_t, int bitrate, overlord_qsv_encoder* output,
    char* error_text, int error_capacity) {
    if (!device || !output || input_width <= 0 || input_height <= 0 || width <= 0 || height <= 0 || fps <= 0) {
        set_error(error_text, error_capacity, "invalid oneVPL create arguments"); return 0;
    }
    *output = nullptr; auto* s = new QSVEncoder(); std::string error;
    s->device = static_cast<ID3D11Device*>(device); s->device->AddRef(); s->device->GetImmediateContext(&s->context);
    s->inputWidth = input_width; s->inputHeight = input_height; s->width = width; s->height = height;
    if (!s->context) { error = "ID3D11Device::GetImmediateContext returned null"; goto fail; }
    if (!validate_intel_device(s, error) || !protect_device_context(s, error) ||
        !s->api.open(error) || !init_session(s, error)) goto fail;
    {
        mfxStatus sts = s->api.SetHandle(s->session, MFX_HANDLE_D3D11_DEVICE, device);
        if (sts != MFX_ERR_NONE) { error = status_error("MFXVideoCORE_SetHandle", sts); goto fail; }
        if (!init_video_processor(s, error)) goto fail;
        mfxVideoParam p = {}; p.IOPattern = MFX_IOPATTERN_IN_VIDEO_MEMORY; p.AsyncDepth = 1;
        p.mfx.CodecId = MFX_CODEC_AVC; p.mfx.CodecProfile = MFX_PROFILE_AVC_MAIN;
        p.mfx.TargetUsage = MFX_TARGETUSAGE_BEST_SPEED; p.mfx.RateControlMethod = MFX_RATECONTROL_VBR;
        p.mfx.TargetKbps = static_cast<mfxU16>(std::max(1, bitrate / 1000)); p.mfx.GopRefDist = 1;
        p.mfx.GopPicSize = static_cast<mfxU16>(std::max(fps * 2, 1)); p.mfx.IdrInterval = 0;
        p.mfx.FrameInfo.FourCC = MFX_FOURCC_NV12; p.mfx.FrameInfo.ChromaFormat = MFX_CHROMAFORMAT_YUV420;
        p.mfx.FrameInfo.Width = static_cast<mfxU16>((width + 15) & ~15); p.mfx.FrameInfo.Height = static_cast<mfxU16>((height + 15) & ~15);
        p.mfx.FrameInfo.CropW = static_cast<mfxU16>(width); p.mfx.FrameInfo.CropH = static_cast<mfxU16>(height);
        p.mfx.FrameInfo.FrameRateExtN = fps; p.mfx.FrameInfo.FrameRateExtD = 1; p.mfx.FrameInfo.PicStruct = MFX_PICSTRUCT_PROGRESSIVE;
        sts = s->api.EncodeInit(s->session, &p);
        if (sts < MFX_ERR_NONE) { error = status_error("MFXVideoENCODE_Init", sts); goto fail; }
        sts = s->api.GetHandle(s->session, MFX_HANDLE_MEMORY_INTERFACE, reinterpret_cast<mfxHDL*>(&s->memory));
        if (sts != MFX_ERR_NONE || !s->memory) { error = status_error("MFXGetMemoryInterface", sts); goto fail; }
    }
    s->bitstream.resize(std::max<size_t>(1024 * 1024, static_cast<size_t>(bitrate) / 2));
    *output = s; return 1;
fail: set_error(error_text, error_capacity, error); destroy(s); return 0;
}

extern "C" int overlord_qsv_encode(overlord_qsv_encoder opaque, void* texture, int force_idr,
    uint8_t* output, int capacity, int* output_size, char* error_text, int error_capacity) {
    auto* s = static_cast<QSVEncoder*>(opaque); if (!s || !texture || !output_size) return 0; *output_size = 0;
    std::string error; if (!convert(s, static_cast<ID3D11Texture2D*>(texture), error)) goto fail;
    {
        mfxSurfaceD3D11Tex2D ext = {};
        ext.SurfaceInterface.Header.SurfaceType = MFX_SURFACE_TYPE_D3D11_TEX2D;
        ext.SurfaceInterface.Header.SurfaceFlags = MFX_SURFACE_FLAG_IMPORT_COPY;
        ext.SurfaceInterface.Header.StructSize = sizeof(ext); ext.texture2D = s->nv12;
        mfxFrameSurface1* surface = nullptr;
        mfxStatus sts = s->memory->ImportFrameSurface(s->memory, MFX_SURFACE_COMPONENT_ENCODE,
            &ext.SurfaceInterface.Header, &surface);
        if (sts != MFX_ERR_NONE || !surface) { error = status_error("ImportFrameSurface", sts); goto fail; }
        mfxBitstream bs = {}; bs.Data = s->bitstream.data(); bs.MaxLength = static_cast<mfxU32>(s->bitstream.size());
        mfxEncodeCtrl ctrl = {}; if (force_idr) ctrl.FrameType = MFX_FRAMETYPE_IDR | MFX_FRAMETYPE_I | MFX_FRAMETYPE_REF;
        mfxSyncPoint sync = nullptr;
        for (int tries = 0;; ++tries) {
            sts = s->api.EncodeFrame(s->session, force_idr ? &ctrl : nullptr, surface, &bs, &sync);
            if (sts != MFX_WRN_DEVICE_BUSY || tries >= 20) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        surface->FrameInterface->Release(surface);
        if (sts == MFX_ERR_MORE_DATA) return 1;
        if (sts != MFX_ERR_NONE || !sync) { error = status_error("MFXVideoENCODE_EncodeFrameAsync", sts); goto fail; }
        sts = s->api.Sync(s->session, sync, 100);
        if (sts != MFX_ERR_NONE) { error = status_error("MFXVideoCORE_SyncOperation", sts); goto fail; }
        *output_size = static_cast<int>(bs.DataLength);
        if (capacity < *output_size || !output) return 2;
        std::memcpy(output, bs.Data + bs.DataOffset, bs.DataLength);
    }
    return 1;
fail: set_error(error_text, error_capacity, error); return 0;
}

extern "C" void overlord_qsv_destroy(overlord_qsv_encoder encoder) { destroy(static_cast<QSVEncoder*>(encoder)); }
